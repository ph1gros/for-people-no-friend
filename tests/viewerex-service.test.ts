import { describe, expect, it } from 'vitest';

import { ViewerExService, type ViewerExSocket } from '../src/main/viewerex/viewerex-service';
import type { ViewerExConfigStore } from '../src/main/storage/viewerex-config-store';
import { DEFAULT_VIEWEREX_SETTINGS, type ViewerExSettings } from '../src/shared/viewerex-ipc';

class FakeSocket implements ViewerExSocket {
  public readyState = 0;
  public onopen: ((event: Event) => void) | null = null;
  public onclose: ((event: Event) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public readonly sent: string[] = [];

  public open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  public send(value: string): void {
    this.sent.push(value);
  }

  public close(): void {
    this.readyState = 3;
    this.onclose?.(new Event('close'));
  }
}

describe('ViewerEX service', () => {
  it('does not create a socket while the adapter is disabled', async () => {
    let socketCount = 0;
    const service = new ViewerExService(
      {
        get: async () => ({ ...DEFAULT_VIEWEREX_SETTINGS }),
        set: async () => undefined,
      } as ViewerExConfigStore,
      () => {
        socketCount += 1;
        return new FakeSocket();
      },
    );

    await expect(service.present({ text: '不会发送' })).resolves.toBe(false);
    expect(socketCount).toBe(0);
    await expect(service.getStatus()).resolves.toMatchObject({ connection: 'disabled' });
  });

  it('connects only to the fixed loopback ExAPI path and fails softly', async () => {
    let settings: ViewerExSettings = {
      ...DEFAULT_VIEWEREX_SETTINGS,
      enabled: true,
      port: 10088,
    };
    const sockets: FakeSocket[] = [];
    const urls: string[] = [];
    const service = new ViewerExService(
      {
        get: async () => ({ ...settings }),
        set: async (next: ViewerExSettings) => {
          settings = { ...next };
        },
      } as ViewerExConfigStore,
      (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    );

    const pending = service.present({ text: '你好' });
    await Promise.resolve();
    sockets[0]?.open();

    await expect(pending).resolves.toBe(true);
    expect(urls).toEqual(['ws://127.0.0.1:10088/api']);
    expect(sockets[0]?.sent).toHaveLength(1);
    expect(JSON.parse(sockets[0]?.sent[0] ?? '{}')).toMatchObject({ msg: 11000 });

    sockets[0]?.close();
    await expect(service.getStatus()).resolves.toMatchObject({ connection: 'disconnected' });
  });

  it('disconnects immediately when settings disable the adapter', async () => {
    let settings: ViewerExSettings = { ...DEFAULT_VIEWEREX_SETTINGS, enabled: true };
    const socket = new FakeSocket();
    const service = new ViewerExService(
      {
        get: async () => ({ ...settings }),
        set: async (next: ViewerExSettings) => {
          settings = { ...next };
        },
      } as ViewerExConfigStore,
      () => socket,
    );

    const pending = service.present({ text: '你好' });
    await Promise.resolve();
    socket.open();
    await pending;
    await service.setSettings({ ...settings, enabled: false });

    expect(socket.readyState).toBe(3);
    await expect(service.getStatus()).resolves.toMatchObject({ connection: 'disabled' });
  });
});
