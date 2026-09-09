import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  KOOK_HEARTBEAT_INTERVAL_MS,
  KOOK_HEARTBEAT_TIMEOUT_MS,
  KookGateway,
  validateKookGatewayUrl,
} from '../src/adapters/social/kook/kook-gateway';
import { KookError, type KookHttp } from '../src/adapters/social/kook/kook-http';

const GATEWAY_URL = 'wss://ws.kookapp.cn/endpoint?token=abc';

class FakeSocket {
  public readonly sent: string[] = [];
  public terminated = 0;
  public readyState = 1;
  private readonly listeners = new Map<string, (arg?: unknown) => void>();

  public on(event: string, handler: (arg?: unknown) => void): this {
    this.listeners.set(event, handler);
    return this;
  }

  public off(): this {
    return this;
  }

  public send(data: unknown): void {
    this.sent.push(String(data));
  }

  public terminate(): void {
    this.terminated += 1;
  }

  public deliver(frame: unknown): void {
    this.listeners.get('message')?.(JSON.stringify(frame));
  }

  public deliverRaw(data: unknown): void {
    this.listeners.get('message')?.(data);
  }

  public close(): void {
    this.listeners.get('close')?.();
  }
}

const harness = () => {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const http = {
    request: vi.fn(async (_method: string, path: string) =>
      path === '/api/v3/user/me' ? { id: 'bot-user-id' } : { url: GATEWAY_URL },
    ),
  } as unknown as KookHttp;
  const gateway = new KookGateway(http, (url) => {
    urls.push(url);
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
  const messages: unknown[] = [];
  const states: string[] = [];
  const ready: string[] = [];
  return {
    gateway,
    sockets,
    urls,
    messages,
    states,
    ready,
    http,
    start: () =>
      gateway.start(new AbortController().signal, {
        ready: (id) => ready.push(id),
        message: (value) => messages.push(value),
        state: (state) => states.push(state),
      }),
    hello: (sessionId = 'session-1') =>
      sockets.at(-1)?.deliver({ s: 1, d: { code: 0, session_id: sessionId } }),
  };
};

describe('KOOK gateway URL validation', () => {
  it('accepts a KOOK websocket endpoint', () => {
    expect(validateKookGatewayUrl(GATEWAY_URL)).toBe(GATEWAY_URL);
    expect(validateKookGatewayUrl('wss://kookapp.cn/x')).toBe('wss://kookapp.cn/x');
  });

  it('refuses any other host, scheme, port or embedded credential', () => {
    for (const bad of [
      'ws://ws.kookapp.cn/x',
      'https://ws.kookapp.cn/x',
      'wss://evil.invalid/x',
      'wss://kookapp.cn.evil.invalid/x',
      'wss://user:pass@ws.kookapp.cn/x',
      'wss://ws.kookapp.cn:8443/x',
      'wss://ws.kookapp.cn/x#frag',
      'not a url',
      42,
      null,
    ]) {
      expect(() => validateKookGatewayUrl(bad)).toThrow(KookError);
    }
  });
});

describe('KOOK gateway session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('identifies itself, connects and reports ready after the hello frame', async () => {
    const h = harness();
    await h.start();

    expect(h.states).toEqual(['connecting']);
    h.hello();

    expect(h.states).toEqual(['connecting', 'online']);
    expect(h.ready).toEqual(['bot-user-id']);
  });

  it('forwards events in sequence order and drops replays', async () => {
    const h = harness();
    await h.start();
    h.hello();

    h.sockets.at(-1)?.deliver({ s: 0, sn: 1, d: { content: 'first' } });
    h.sockets.at(-1)?.deliver({ s: 0, sn: 2, d: { content: 'second' } });
    // Replayed and out-of-order frames must not reach the adapter twice.
    h.sockets.at(-1)?.deliver({ s: 0, sn: 2, d: { content: 'replay' } });
    h.sockets.at(-1)?.deliver({ s: 0, sn: 1, d: { content: 'older' } });
    h.sockets.at(-1)?.deliver({ s: 0, d: { content: 'no sequence' } });

    expect(h.messages).toEqual([{ content: 'first' }, { content: 'second' }]);
  });

  it('ignores frames it cannot decode or that are too large', async () => {
    const h = harness();
    await h.start();
    h.hello();

    h.sockets.at(-1)?.deliverRaw('not json');
    h.sockets.at(-1)?.deliverRaw('[1,2,3]');
    h.sockets.at(-1)?.deliverRaw(new Uint8Array(600 * 1024));
    h.sockets.at(-1)?.deliver({ s: 99, d: {} });

    expect(h.messages).toHaveLength(0);
  });

  it('sends heartbeats carrying the last sequence and clears them on pong', async () => {
    const h = harness();
    await h.start();
    h.hello();
    h.sockets.at(-1)?.deliver({ s: 0, sn: 7, d: {} });

    await vi.advanceTimersByTimeAsync(KOOK_HEARTBEAT_INTERVAL_MS);
    expect(h.sockets.at(-1)?.sent.at(-1)).toBe(JSON.stringify({ s: 2, sn: 7 }));

    h.sockets.at(-1)?.deliver({ s: 3 });
    await vi.advanceTimersByTimeAsync(KOOK_HEARTBEAT_TIMEOUT_MS + 100);
    expect(h.sockets.at(-1)?.terminated).toBe(0);
  });

  it('reconnects after repeated heartbeat timeouts', async () => {
    const h = harness();
    await h.start();
    h.hello();

    await vi.advanceTimersByTimeAsync(KOOK_HEARTBEAT_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(KOOK_HEARTBEAT_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(KOOK_HEARTBEAT_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(h.sockets.length).toBeGreaterThan(1);
    expect(h.states).toContain('connecting');
  });

  it('resumes with the buffered sequence, but starts clean after a reconnect signal', async () => {
    const h = harness();
    await h.start();
    h.hello('session-7');
    h.sockets.at(-1)?.deliver({ s: 0, sn: 4, d: {} });

    h.sockets.at(-1)?.close();
    await vi.advanceTimersByTimeAsync(2_000);
    const resumed = new URL(h.urls.at(-1) as string);
    expect(resumed.searchParams.get('resume')).toBe('1');
    expect(resumed.searchParams.get('sn')).toBe('4');
    expect(resumed.searchParams.get('session_id')).toBe('session-7');

    h.hello('session-7');
    h.sockets.at(-1)?.deliver({ s: 5, d: { code: 40106 } });
    await vi.advanceTimersByTimeAsync(4_000);
    const fresh = new URL(h.urls.at(-1) as string);
    expect(fresh.searchParams.get('resume')).toBeNull();
    expect(fresh.searchParams.get('sn')).toBeNull();
  });

  it('stops cleanly and reports going offline', async () => {
    const h = harness();
    await h.start();
    h.hello();

    h.gateway.stop();

    expect(h.states.at(-1)).toBe('offline');
    expect(h.sockets.at(-1)?.terminated).toBe(1);
  });

  it('refuses a gateway URL the API did not authorize', async () => {
    const h = harness();
    vi.mocked(h.http.request).mockImplementation(async (_method: string, path: string) =>
      path === '/api/v3/user/me' ? { id: 'bot-user-id' } : { url: 'wss://evil.invalid/x' },
    );

    await expect(h.start()).rejects.toThrow(KookError);
  });

  it('refuses a malformed identity response', async () => {
    const h = harness();
    vi.mocked(h.http.request).mockResolvedValue({ id: 'not a valid id' });

    await expect(h.start()).rejects.toThrow(KookError);
  });
});
