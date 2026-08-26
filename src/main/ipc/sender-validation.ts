import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

export interface SenderValidationWindow {
  isDestroyed(): boolean;
  webContents: Pick<BrowserWindow['webContents'], 'mainFrame'>;
}

export const isTrustedIpcSender = (
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  window: SenderValidationWindow | undefined,
): boolean =>
  Boolean(
    window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame,
  );
