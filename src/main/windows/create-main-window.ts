import { BrowserWindow } from 'electron';

import { resolveWindowAssetPaths } from './window-assets';
import {
  DEFAULT_WINDOW_SIZE,
  EXPANDED_WINDOW_SIZE,
  SETTINGS_WINDOW_SIZE,
  MAX_WINDOW_SCALE,
  MIN_WINDOW_SCALE,
  type PersistedWindowState,
  stateToBounds,
} from './window-state';

export const configureMainWindowLayout = (
  window: BrowserWindow,
  expanded: boolean,
  settings = false,
): void => {
  const size = settings
    ? SETTINGS_WINDOW_SIZE
    : expanded
      ? EXPANDED_WINDOW_SIZE
      : DEFAULT_WINDOW_SIZE;
  window.setAspectRatio(0);
  window.setMinimumSize(
    Math.round(size.width * MIN_WINDOW_SCALE),
    Math.round(size.height * MIN_WINDOW_SCALE),
  );
  window.setMaximumSize(
    Math.round(size.width * MAX_WINDOW_SCALE),
    Math.round(size.height * MAX_WINDOW_SCALE),
  );
  window.setAspectRatio(size.width / size.height);
};

export const createMainWindow = (state: PersistedWindowState): BrowserWindow => {
  const bounds = stateToBounds(state);
  const assets = resolveWindowAssetPaths(__dirname);
  const window = new BrowserWindow({
    ...bounds,
    minWidth: Math.round(DEFAULT_WINDOW_SIZE.width * MIN_WINDOW_SCALE),
    minHeight: Math.round(DEFAULT_WINDOW_SIZE.height * MIN_WINDOW_SCALE),
    maxWidth: Math.round(DEFAULT_WINDOW_SIZE.width * MAX_WINDOW_SCALE),
    maxHeight: Math.round(DEFAULT_WINDOW_SIZE.height * MAX_WINDOW_SCALE),
    show: false,
    transparent: true,
    frame: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    icon: assets.icon,
    webPreferences: {
      preload: assets.preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  configureMainWindowLayout(window, false);
  window.setAlwaysOnTop(true, 'floating');
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  window.on('maximize', () => window.unmaximize());

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(assets.renderer);
  }

  return window;
};
