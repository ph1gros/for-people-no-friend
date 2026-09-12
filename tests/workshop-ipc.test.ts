import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ handle: vi.fn(), openExternal: vi.fn(async () => {}) }));
vi.mock('electron', () => ({
  app: {},
  dialog: {},
  screen: {},
  ipcMain: { handle: mocks.handle },
  shell: { openExternal: mocks.openExternal },
}));
import { registerIpcHandlers } from '../src/main/ipc/register-ipc-handlers';

it('opens only the fixed official workshop destinations from the trusted main frame', async () => {
  const webContents = { mainFrame: {} };
  registerIpcHandlers({
    windows: { getWindow: () => ({ isDestroyed: () => false, webContents }) },
  } as never);
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  for (const [channel, url] of [
    ['viewerex:openWorkshop', 'https://steamcommunity.com/app/616720/workshop/'],
    ['vtubeStudio:openWorkshop', 'https://steamcommunity.com/app/1325860/workshop/'],
  ]) {
    const handler = mocks.handle.mock.calls.find(([name]) => name === channel)?.[1];
    expect(handler).toBeTypeOf('function');
    expect(() => handler({ sender: {}, senderFrame: {} })).toThrow('Unauthorized');
    await expect(handler(event, 'https://untrusted.invalid/script')).resolves.toMatchObject({
      ok: true,
    });
    expect(mocks.openExternal).toHaveBeenLastCalledWith(url);
    mocks.openExternal.mockRejectedValueOnce(new Error('offline'));
    await expect(handler(event)).resolves.toMatchObject({ ok: false });
  }
});
