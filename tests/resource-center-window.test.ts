import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const created = vi.hoisted(() => ({ windows: [] as unknown[] }));
vi.mock('electron', () => ({
  BrowserWindow: class extends EventEmitter {
    destroyed = false;
    minimized = false;
    show = vi.fn();
    focus = vi.fn();
    restore = vi.fn(() => {
      this.minimized = false;
    });
    loadFile = vi.fn(async () => undefined);
    loadURL = vi.fn(async () => undefined);
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() });
    constructor(public options: Record<string, unknown>) {
      super();
      created.windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    isMinimized() {
      return this.minimized;
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
  },
}));

import { ResourceCenterWindow } from '../src/main/windows/resource-center-window';

describe('independent resource center window', () => {
  beforeEach(() => {
    created.windows = [];
    vi.stubEnv('VITE_DEV_SERVER_URL', '');
  });

  it('opens one normal taskbar window, restores it, and can reopen after close', async () => {
    const manager = new ResourceCenterWindow();
    await manager.open();
    const window = manager.getWindow()!;
    expect(created.windows).toHaveLength(1);
    expect((window as unknown as { options: unknown }).options).toMatchObject({
      skipTaskbar: false,
      frame: true,
      resizable: true,
      alwaysOnTop: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    expect(window.loadFile).toHaveBeenCalledWith(expect.stringMatching(/resource-center\.html$/));
    (window as unknown as { minimized: boolean }).minimized = true;
    await manager.open();
    expect(created.windows).toHaveLength(1);
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalled();
    window.destroy();
    expect(manager.getWindow()).toBeUndefined();
    await manager.open();
    expect(created.windows).toHaveLength(2);
    manager.dispose();
    expect(manager.getWindow()).toBeUndefined();
  });

  it('blocks navigation, webviews and additional windows', async () => {
    const manager = new ResourceCenterWindow();
    await manager.open();
    const contents = manager.getWindow()!.webContents;
    const event = { preventDefault: vi.fn() };
    contents.emit('will-navigate', event, 'https://example.com');
    contents.emit('will-attach-webview', event);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    const handler = vi.mocked(contents.setWindowOpenHandler).mock.calls[0]?.[0];
    expect(handler?.({} as never)).toEqual({ action: 'deny' });
    manager.dispose();
  });
});
