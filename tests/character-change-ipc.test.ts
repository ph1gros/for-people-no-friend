import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerIpcHandlers } from '../src/main/ipc/register-ipc-handlers';
import { IPC_CHANNELS } from '../src/shared/ipc';

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => unknown>(),
  showOpenDialog: vi.fn(),
}));
vi.mock('electron', () => ({
  app: {},
  screen: {},
  shell: {},
  dialog: { showOpenDialog: electron.showOpenDialog },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown) => unknown) =>
      electron.handlers.set(channel, handler),
  },
}));

beforeEach(() => {
  electron.handlers.clear();
  electron.showOpenDialog.mockReset();
});

describe('character-change IPC cancellation boundaries', () => {
  const setup = () => {
    const onCharacterChanging = vi.fn();
    const clearInactive = vi.fn(async () => undefined);
    const importModel = vi.fn(async () => {
      expect(onCharacterChanging).toHaveBeenCalledOnce();
      return { modelName: 'fake', assetCount: 1, importedBytes: 1 };
    });
    const window = { isDestroyed: () => false, webContents: { mainFrame: {} } };
    registerIpcHandlers({
      windows: { getWindow: () => window },
      onCharacterChanging,
      characterPackages: { clearInactive },
      live2DModelImports: { importModel },
    } as never);
    return {
      onCharacterChanging,
      clearInactive,
      importModel,
      invoke: (channel: string) =>
        electron.handlers.get(channel)!({
          sender: window.webContents,
          senderFrame: window.webContents.mainFrame,
        }),
    };
  };

  it('preserves online sessions when removing only inactive characters', async () => {
    const h = setup();
    await expect(h.invoke(IPC_CHANNELS.clearInactiveCharacters)).resolves.toMatchObject({
      ok: true,
    });
    expect(h.clearInactive).toHaveBeenCalledOnce();
    expect(h.onCharacterChanging).not.toHaveBeenCalled();
  });

  it('does not cancel sessions while a dialog is open or after cancellation', async () => {
    const h = setup();
    let close!: () => void;
    electron.showOpenDialog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          close = () => resolve({ canceled: true, filePaths: [] });
        }),
    );
    const importing = h.invoke(IPC_CHANNELS.importLive2DModel);
    expect(h.onCharacterChanging).not.toHaveBeenCalled();
    close();
    await expect(importing).resolves.toEqual({ ok: true, canceled: true });
    expect(h.onCharacterChanging).not.toHaveBeenCalled();
    expect(h.importModel).not.toHaveBeenCalled();
  });

  it('still cancels sessions before importing an accepted model selection', async () => {
    const h = setup();
    electron.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['fake.model3.json'],
    });
    await expect(h.invoke(IPC_CHANNELS.importLive2DModel)).resolves.toMatchObject({
      ok: true,
      canceled: false,
    });
    expect(h.importModel).toHaveBeenCalledOnce();
    expect(h.onCharacterChanging).toHaveBeenCalledOnce();
  });
});
