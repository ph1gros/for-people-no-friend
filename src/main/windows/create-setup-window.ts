import { BrowserWindow } from 'electron';

import { resolveSetupWindowAssetPaths } from './window-assets';

export const SETUP_WINDOW_SIZE = Object.freeze({ width: 760, height: 560 });
export const SETUP_WINDOW_MINIMUM_SIZE = Object.freeze({ width: 640, height: 480 });
export const SETUP_WINDOW_TITLE = 'For People No Friend 安装向导';
/** In-memory session so setup never changes the permission handlers of the deskpet window. */
export const SETUP_WINDOW_PARTITION = 'setup-wizard';

const windowLoads = new WeakMap<BrowserWindow, Promise<void>>();

export const waitForSetupWindowLoad = (window: BrowserWindow): Promise<void> =>
  windowLoads.get(window) ?? Promise.resolve();

/**
 * A conventional framed Windows wizard window. It deliberately does not reuse the transparent,
 * always-on-top deskpet window: setup is a normal modal-style dialog the user can move,
 * and it receives only the narrow setup preload bridge.
 */
export const createSetupWindow = (
  assets = resolveSetupWindowAssetPaths(__dirname),
  devServerUrl = process.env.VITE_DEV_SERVER_URL,
): BrowserWindow => {
  const window = new BrowserWindow({
    width: SETUP_WINDOW_SIZE.width,
    height: SETUP_WINDOW_SIZE.height,
    minWidth: SETUP_WINDOW_MINIMUM_SIZE.width,
    minHeight: SETUP_WINDOW_MINIMUM_SIZE.height,
    show: false,
    title: SETUP_WINDOW_TITLE,
    backgroundColor: '#1b1c1f',
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    icon: assets.icon,
    webPreferences: {
      preload: assets.preload,
      partition: SETUP_WINDOW_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once('ready-to-show', () => window.show());

  const loading = devServerUrl
    ? window.loadURL(new URL('setup/index.html', devServerUrl).toString())
    : window.loadFile(assets.renderer);
  windowLoads.set(window, loading);
  // Startup awaits the original promise after registering the window lifetime handlers.
  // Attach a rejection handler immediately, including for callers that only create a window.
  void loading.catch(() => undefined);

  return window;
};
