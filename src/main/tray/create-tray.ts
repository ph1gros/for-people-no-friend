import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron';

export interface TrayActions {
  getWindow(): BrowserWindow | undefined;
  show(): void;
  hide(): void;
  toggleVisibility(): void;
}

export const createDeskpetTray = (actions: TrayActions): Tray => {
  const icon = nativeImage.createFromPath(process.execPath).resize({ width: 16, height: 16 });
  const tray = new Tray(icon);

  const updateMenu = (): void => {
    const isVisible = actions.getWindow()?.isVisible() ?? false;
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: isVisible ? '隐藏桌宠' : '显示桌宠',
          click: isVisible ? actions.hide : actions.show,
        },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() },
      ]),
    );
  };

  tray.setToolTip('For people no friend');
  tray.on('click', actions.toggleVisibility);
  actions.getWindow()?.on('show', updateMenu);
  actions.getWindow()?.on('hide', updateMenu);
  updateMenu();

  return tray;
};
