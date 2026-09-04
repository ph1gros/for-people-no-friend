import path from 'node:path';

import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron';

export interface TrayActions {
  getWindow(): BrowserWindow | undefined;
  show(): void;
  hide(): void;
  toggleVisibility(): void;
  openResourceCenter?(): void;
}

export const createDeskpetTray = (actions: TrayActions): Tray => {
  const applicationIcon = nativeImage.createFromPath(
    path.join(app.getAppPath(), 'build', 'icon.png'),
  );
  const icon = (
    applicationIcon.isEmpty() ? nativeImage.createFromPath(process.execPath) : applicationIcon
  ).resize({
    width: 16,
    height: 16,
  });
  const tray = new Tray(icon);

  const updateMenu = (): void => {
    const isVisible = actions.getWindow()?.isVisible() ?? false;
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: isVisible ? '隐藏桌宠' : '显示桌宠',
          click: isVisible ? actions.hide : actions.show,
        },
        ...(actions.openResourceCenter
          ? [{ label: '资源中心', click: actions.openResourceCenter }]
          : []),
        { type: 'separator' },
        { label: '退出', click: () => app.quit() },
      ]),
    );
  };

  tray.setToolTip('For People No Friend');
  tray.on('click', actions.toggleVisibility);
  actions.getWindow()?.on('show', updateMenu);
  actions.getWindow()?.on('hide', updateMenu);
  updateMenu();

  return tray;
};
