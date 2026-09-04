import path from 'node:path';
import { BrowserWindow } from 'electron';

import { resolveWindowAssetPaths } from './window-assets';

/** One non-modal resource window; downloads belong to Main and survive closing this view. */
export class ResourceCenterWindow {
  private window: BrowserWindow | undefined;

  public getWindow(): BrowserWindow | undefined {
    return this.window && !this.window.isDestroyed() ? this.window : undefined;
  }

  public async open(): Promise<void> {
    const existing = this.getWindow();
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return;
    }
    const assets = resolveWindowAssetPaths(__dirname);
    const window = new BrowserWindow({
      width: 1080,
      height: 780,
      minWidth: 640,
      minHeight: 480,
      title: '资源中心 · For People No Friend',
      show: false,
      frame: true,
      resizable: true,
      skipTaskbar: false,
      alwaysOnTop: false,
      backgroundColor: '#141922',
      icon: assets.icon,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(path.dirname(assets.preload), 'resource-center.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    this.window = window;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.on('closed', () => {
      if (this.window === window) this.window = undefined;
    });
    try {
      const devServerUrl = process.env.VITE_DEV_SERVER_URL;
      if (devServerUrl) {
        await window.loadURL(new URL('/resource-center.html', devServerUrl).toString());
      } else {
        await window.loadFile(path.join(path.dirname(assets.renderer), 'resource-center.html'));
      }
      if (!window.isDestroyed()) {
        window.show();
        window.focus();
      }
    } catch {
      if (!window.isDestroyed()) window.destroy();
      throw new Error('资源中心窗口加载失败，请重试。');
    }
  }

  public dispose(): void {
    this.getWindow()?.destroy();
    this.window = undefined;
  }
}
