import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTrustedIpcHandlerRegistrar } from '../src/main/ipc/register-ipc-handlers';
import { isTrustedIpcSender } from '../src/main/ipc/sender-validation';

describe('IPC sender validation', () => {
  it('admits the resource main frame only on explicitly scoped handlers', () => {
    const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (event: never, ...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const main = { isDestroyed: () => false, webContents: { mainFrame: {} } };
    const resource = { isDestroyed: () => false, webContents: { mainFrame: {} } };
    const windows = { getWindow: () => main };
    createTrustedIpcHandlerRegistrar(ipc as never, windows as never)('private', () => 'private');
    createTrustedIpcHandlerRegistrar(
      ipc as never,
      windows as never,
      'throw',
      () => resource as never,
    )('resources', () => 'allowed');
    const event = { sender: resource.webContents, senderFrame: resource.webContents.mainFrame };
    expect(handlers.get('resources')!(event as never)).toBe('allowed');
    expect(() => handlers.get('private')!(event as never)).toThrow('Unauthorized');
    expect(() => handlers.get('resources')!({ ...event, senderFrame: {} } as never)).toThrow(
      'Unauthorized',
    );
    expect(() => handlers.get('resources')!({ ...event, sender: {} } as never)).toThrow(
      'Unauthorized',
    );
    resource.isDestroyed = () => true;
    expect(() => handlers.get('resources')!(event as never)).toThrow('Unauthorized');
  });
  it('treats an additional window as trusted on silent handlers too', () => {
    // The two branches of the registrar must agree on who is trusted. If the silent branch only
    // consulted the main window, a legitimate call from the resource window would return
    // undefined with no error at all — the hardest kind of failure to trace.
    const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
    const ipc = {
      handle: (channel: string, handler: (event: never, ...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
    };
    const main = { isDestroyed: () => false, webContents: { mainFrame: {} } };
    const resource = { isDestroyed: () => false, webContents: { mainFrame: {} } };
    createTrustedIpcHandlerRegistrar(
      ipc as never,
      { getWindow: () => main } as never,
      'return-undefined',
      () => resource as never,
    )('silent-scoped', () => 'allowed');

    const fromResource = {
      sender: resource.webContents,
      senderFrame: resource.webContents.mainFrame,
    };
    expect(handlers.get('silent-scoped')!(fromResource as never)).toBe('allowed');

    const fromMain = { sender: main.webContents, senderFrame: main.webContents.mainFrame };
    expect(handlers.get('silent-scoped')!(fromMain as never)).toBe('allowed');

    const stranger = { sender: {}, senderFrame: {} };
    expect(handlers.get('silent-scoped')!(stranger as never)).toBeUndefined();
  });

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

  it('guards registered handlers before invoking their implementation', async () => {
    let registered: ((event: unknown, input: unknown) => unknown) | undefined;
    let implementationCalls = 0;
    const mainFrame = {};
    const webContents = { mainFrame };
    const windows = {
      getWindow: () => ({ isDestroyed: () => false, webContents }),
    };
    const handle = createTrustedIpcHandlerRegistrar(
      {
        handle: (_channel, handler) => {
          registered = handler as typeof registered;
        },
      },
      windows as never,
    );
    handle('test:guarded', (_event, input) => {
      implementationCalls += 1;
      return input;
    });

    expect(() => registered?.({ sender: {}, senderFrame: {} }, 'blocked')).toThrow(
      'Unauthorized IPC sender',
    );
    expect(implementationCalls).toBe(0);
    expect(registered?.({ sender: webContents, senderFrame: mainFrame }, 'allowed')).toBe(
      'allowed',
    );
    expect(implementationCalls).toBe(1);
  });

  it('registers the complete IPC surface only through the guarded registrar', () => {
    const source = readFileSync(resolve('src/main/ipc/register-ipc-handlers.ts'), 'utf8');
    expect(source).not.toContain('ipcMain.handle(');
    expect(source).toContain('const handle = createTrustedIpcHandlerRegistrar(ipcMain, windows)');
  });
});
