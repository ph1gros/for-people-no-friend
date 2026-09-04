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
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const isTrustedMicrophoneRequest = (
    requestingWebContents: Electron.WebContents | null,
    permission: string,
    requestingUrl: string,
    mediaTypes?: string[],
  ): boolean => {
    if (
      requestingWebContents !== window.webContents ||
      permission !== 'media' ||
      mediaTypes?.length !== 1 ||
      mediaTypes[0] !== 'audio'
    ) {
      return false;
    }
    try {
      const origin = new URL(requestingUrl);
      if (origin.protocol === 'file:') return true;
      return Boolean(devServerUrl && origin.origin === new URL(devServerUrl).origin);
    } catch {
      return false;
    }
  };
  window.webContents.session.setPermissionRequestHandler(
    (requestingWebContents, permission, callback, details) => {
      const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
      callback(
        details.isMainFrame &&
          isTrustedMicrophoneRequest(
            requestingWebContents,
            permission,
            details.requestingUrl,
            mediaTypes,
          ),
      );
    },
  );
  window.webContents.session.setPermissionCheckHandler(
    (requestingWebContents, permission, requestingOrigin, details) =>
      isTrustedMicrophoneRequest(
        requestingWebContents,
        permission,
        requestingOrigin,
        details.mediaType ? [details.mediaType] : undefined,
      ),
  );
  window.on('maximize', () => window.unmaximize());

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(assets.renderer);
  }

  return window;
};
