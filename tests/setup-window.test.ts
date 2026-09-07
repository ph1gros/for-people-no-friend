import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface RecordedWindow {
  options: Record<string, unknown>;
  menuBarVisible: boolean | undefined;
  windowOpenHandlerResult: unknown;
  webContentsEvents: string[];
  permissionRequestResults: boolean[];
  permissionCheckResult: boolean | undefined;
  loadedFile: string | undefined;
  loadedUrl: string | undefined;
}

const windowState = vi.hoisted(() => ({ created: [] as unknown[] }));

vi.mock('electron', () => {
  class FakeBrowserWindow {
    public readonly options: Record<string, unknown>;
    public menuBarVisible: boolean | undefined;
    public windowOpenHandlerResult: unknown;
    public readonly webContentsEvents: string[] = [];
    public readonly permissionRequestResults: boolean[] = [];
    public permissionCheckResult: boolean | undefined;
    public loadedFile: string | undefined;
    public loadedUrl: string | undefined;
    public readonly webContents: Record<string, unknown>;

    public constructor(options: Record<string, unknown>) {
      this.options = options;
      this.webContents = {
        setWindowOpenHandler: (handler: () => unknown) => {
          this.windowOpenHandlerResult = handler();
        },
        on: (event: string) => {
          this.webContentsEvents.push(event);
        },
        session: {
          setPermissionRequestHandler: (
            handler: (
              contents: unknown,
              permission: string,
              callback: (allowed: boolean) => void,
            ) => void,
          ) => {
            handler(null, 'media', (allowed) => this.permissionRequestResults.push(allowed));
          },
          setPermissionCheckHandler: (handler: () => boolean) => {
            this.permissionCheckResult = handler();
          },
        },
      };
      windowState.created.push(this);
    }

    public setMenuBarVisibility(visible: boolean): void {
      this.menuBarVisible = visible;
    }

    public once(): this {
      return this;
    }

    public loadFile(file: string): Promise<void> {
      this.loadedFile = file;
      return Promise.resolve();
    }

    public loadURL(url: string): Promise<void> {
      this.loadedUrl = url;
      return Promise.resolve();
    }
  }

  return { BrowserWindow: FakeBrowserWindow };
});

import { createSetupWindow, SETUP_WINDOW_PARTITION } from '../src/main/windows/create-setup-window';
import { resolveSetupWindowAssetPaths } from '../src/main/windows/window-assets';

const repository = path.resolve('C:/example/for-people-no-friend');
const assets = resolveSetupWindowAssetPaths(
  path.join(repository, 'dist-electron', 'main', 'windows'),
);

describe('setup window assets', () => {
  it('loads the setup bridge and page instead of the deskpet ones', () => {
    expect(assets).toEqual({
      icon: path.join(repository, 'build', 'icon.png'),
      preload: path.join(repository, 'dist-electron', 'preload', 'setup.cjs'),
      renderer: path.join(repository, 'dist', 'renderer', 'setup', 'index.html'),
    });
  });
});

describe('setup window creation', () => {
  beforeEach(() => {
    windowState.created.length = 0;
  });

  const create = (devServerUrl?: string): RecordedWindow =>
    createSetupWindow(assets, devServerUrl) as unknown as RecordedWindow;

  it('keeps the renderer sandboxed behind the narrow setup preload', () => {
    const window = create(undefined);

    expect(window.options.webPreferences).toEqual({
      preload: assets.preload,
      partition: SETUP_WINDOW_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    });
  });

  it('uses a conventional framed window rather than the deskpet overlay', () => {
    const window = create(undefined);

    expect(window.options).toMatchObject({
      show: false,
      resizable: true,
      maximizable: false,
      fullscreenable: false,
    });
    expect(window.options.transparent).toBeUndefined();
    expect(window.options.alwaysOnTop).toBeUndefined();
    expect(window.options.frame).toBeUndefined();
    expect(window.menuBarVisible).toBe(false);
  });

  it('denies popups, webviews, navigation and every permission request', () => {
    const window = create(undefined);

    expect(window.windowOpenHandlerResult).toEqual({ action: 'deny' });
    expect(window.webContentsEvents).toEqual(['will-attach-webview', 'will-navigate']);
    expect(window.permissionRequestResults).toEqual([false]);
    expect(window.permissionCheckResult).toBe(false);
  });

  it('loads the packaged setup page, or the development server page', () => {
    expect(create(undefined).loadedFile).toBe(assets.renderer);
    expect(create('http://127.0.0.1:5173').loadedUrl).toBe(
      'http://127.0.0.1:5173/setup/index.html',
    );
  });
});
