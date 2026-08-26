import { describe, expect, it } from 'vitest';

import { isTrustedIpcSender } from '../src/main/ipc/sender-validation';

describe('IPC sender validation', () => {
  it('requires both the trusted webContents and its main frame', () => {
    const mainFrame = {};
    const webContents = { mainFrame };
    const window = {
      isDestroyed: () => false,
      webContents,
    };

    expect(
      isTrustedIpcSender({ sender: webContents, senderFrame: mainFrame } as never, window as never),
    ).toBe(true);
    expect(
      isTrustedIpcSender({ sender: webContents, senderFrame: {} } as never, window as never),
    ).toBe(false);
    expect(
      isTrustedIpcSender({ sender: {}, senderFrame: mainFrame } as never, window as never),
    ).toBe(false);
  });

  it('rejects destroyed or missing windows', () => {
    const mainFrame = {};
    const webContents = { mainFrame };
    expect(
      isTrustedIpcSender(
        { sender: webContents, senderFrame: mainFrame } as never,
        { isDestroyed: () => true, webContents } as never,
      ),
    ).toBe(false);
    expect(
      isTrustedIpcSender({ sender: webContents, senderFrame: mainFrame } as never, undefined),
    ).toBe(false);
  });
});
