import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OneBotAdapter } from '../src/adapters/social/onebot/onebot-adapter';
import {
  ONEBOT_CALL_TIMEOUT_MS,
  ONEBOT_MAX_PENDING_CALLS,
  OneBotConnection,
  OneBotError,
  validateOneBotUrl,
} from '../src/adapters/social/onebot/onebot-connection';
import type {
  SocialMessage,
  SocialSendContext,
  SocialTarget,
} from '../src/core/social/social-contracts';

const URL_OK = 'ws://127.0.0.1:6700/';

class FakeSocket {
  public readonly sent: string[] = [];
  public terminated = 0;
  public closeOnTerminate = false;
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
    if (this.closeOnTerminate) this.close();
  }
  public open(): void {
    this.listeners.get('open')?.();
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
  public fail(): void {
    this.listeners.get('error')?.(new Error('fake socket error'));
  }
  public lastCall(): { action: string; echo: string; params: Record<string, unknown> } {
    const frame = this.sent.at(-1);
    if (!frame) throw new Error('No frame sent.');
    return JSON.parse(frame) as { action: string; echo: string; params: Record<string, unknown> };
  }
}

const harness = (options: { accessToken?: string } = {}) => {
  const sockets: FakeSocket[] = [];
  const init: Array<Record<string, unknown>> = [];
  const connection = new OneBotConnection({
    url: URL_OK,
    ...(options.accessToken ? { accessToken: options.accessToken } : {}),
    webSocketFactory: (_url, clientOptions) => {
      init.push(clientOptions as unknown as Record<string, unknown>);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  const events: unknown[] = [];
  const states: string[] = [];
  const ready: string[] = [];
  connection.start({
    ready: (id) => ready.push(id),
    event: (value) => events.push(value),
    state: (state) => states.push(state),
  });
  const login = async (userId: unknown = 10001) => {
    const socket = sockets.at(-1) as FakeSocket;
    socket.open();
    await Promise.resolve();
    socket.deliver({
      status: 'ok',
      retcode: 0,
      data: { user_id: userId },
      echo: socket.lastCall().echo,
    });
    await vi.waitFor(() =>
      expect(ready.length + states.filter((s) => s === 'error').length).toBeGreaterThan(0),
    );
  };
  return { connection, sockets, init, events, states, ready, login };
};

describe('OneBot endpoint validation', () => {
  it('accepts a loopback websocket endpoint', () => {
    expect(validateOneBotUrl('ws://127.0.0.1:6700')).toBe(URL_OK);
    expect(validateOneBotUrl('ws://localhost:6700/onebot')).toContain('localhost');
    expect(validateOneBotUrl('wss://[::1]:6700/')).toContain('::1');
  });

  it('refuses every non-loopback host and unsafe form', () => {
    for (const bad of [
      'ws://192.168.1.10:6700',
      'ws://10.0.0.1:6700',
      'ws://example.invalid:6700',
      'ws://127.0.0.1.evil.invalid:6700',
      'http://127.0.0.1:6700',
      'https://127.0.0.1:6700',
      'ws://user:pass@127.0.0.1:6700',
      'ws://127.0.0.1:6700/#frag',
      'not a url',
      '',
      42,
      null,
    ]) {
      expect(() => validateOneBotUrl(bad)).toThrow(OneBotError);
    }
  });

  it('refuses to construct a connection to a non-loopback endpoint', () => {
    expect(() => new OneBotConnection({ url: 'ws://203.0.113.10:6700' })).toThrow(OneBotError);
  });
});

describe('OneBot connection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks for the login identity before forwarding any event', async () => {
    const h = harness();
    const socket = h.sockets[0] as FakeSocket;

    socket.open();
    await Promise.resolve();
    expect(socket.lastCall().action).toBe('get_login_info');

    // Events arriving before the identity is known must not reach the adapter.
    socket.deliver({ post_type: 'message', message_type: 'private', user_id: 1 });
    expect(h.events).toHaveLength(0);

    socket.deliver({
      status: 'ok',
      retcode: 0,
      data: { user_id: 10001 },
      echo: socket.lastCall().echo,
    });
    await vi.waitFor(() => expect(h.ready).toEqual(['10001']));

    socket.deliver({ post_type: 'message', message_type: 'private', user_id: 1 });
    expect(h.events).toHaveLength(1);
  });

  it('sends the access token as a header only', async () => {
    const h = harness({ accessToken: 'fake-onebot-token' });

    expect(h.init[0]?.headers).toEqual({ Authorization: 'Bearer fake-onebot-token' });
    // The credential must never appear in a frame on the wire.
    await h.login();
    expect(h.sockets[0]?.sent.join('')).not.toContain('fake-onebot-token');
  });

  it('correlates responses by echo and rejects a failed action', async () => {
    const h = harness();
    await h.login();
    const socket = h.sockets[0] as FakeSocket;

    const ok = h.connection.call('send_private_msg', { user_id: '1' });
    const okEcho = socket.lastCall().echo;
    const failing = h.connection.call('send_group_msg', { group_id: '2' });
    const failEcho = socket.lastCall().echo;

    socket.deliver({ status: 'failed', retcode: 1_400, echo: failEcho });
    socket.deliver({ status: 'ok', retcode: 0, data: { message_id: 77 }, echo: okEcho });

    await expect(ok).resolves.toEqual({ message_id: 77 });
    await expect(failing).rejects.toMatchObject({ fault: 'response' });
  });

  it('times out a call that never gets a response', async () => {
    const h = harness();
    await h.login();

    // Attach the assertion before advancing: the rejection must already have a handler.
    const settled = expect(
      h.connection.call('send_private_msg', { user_id: '1' }),
    ).rejects.toMatchObject({ fault: 'timeout' });
    await vi.advanceTimersByTimeAsync(ONEBOT_CALL_TIMEOUT_MS + 100);

    await settled;
  });

  it('bounds the number of in-flight calls and validates the action name', async () => {
    const h = harness();
    await h.login();

    const inflight = Array.from({ length: ONEBOT_MAX_PENDING_CALLS }, () =>
      h.connection.call('send_private_msg', { user_id: '1' }).catch(() => undefined),
    );
    await expect(h.connection.call('send_private_msg', { user_id: '1' })).rejects.toMatchObject({
      fault: 'request',
    });
    await expect(h.connection.call('Bad Action', {})).rejects.toMatchObject({ fault: 'input' });

    h.connection.stop();
    await Promise.all(inflight);
  });

  it('ignores frames it cannot decode and unknown echoes', async () => {
    const h = harness();
    await h.login();
    const socket = h.sockets[0] as FakeSocket;

    socket.deliverRaw('not json');
    socket.deliverRaw('[1,2,3]');
    socket.deliverRaw(new Uint8Array(600 * 1024));
    for (const malformed of [
      Buffer.from([0xff]),
      new Uint8Array([0xc3, 0x28]),
      new Uint8Array([0xff]).buffer,
    ]) {
      expect(() => socket.deliverRaw(malformed)).not.toThrow();
    }
    socket.deliver({ status: 'ok', echo: 'someone-elses-echo', data: {} });

    expect(h.events).toHaveLength(0);
  });

  it('schedules exactly one reconnect for error, terminate-close and late close callbacks', async () => {
    const h = harness();
    await h.login();
    const first = h.sockets[0]!;
    first.closeOnTerminate = true;
    first.fail();
    first.close();
    first.fail();
    expect(first.terminated).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(2);
    const current = h.sockets[1]!;
    current.open();
    first.open();
    first.close();
    first.fail();
    first.deliver({
      status: 'ok',
      retcode: 0,
      echo: current.lastCall().echo,
      data: { user_id: 'stale' },
    });
    expect(h.connection.connected).toBe(false);
    expect(current.terminated).toBe(0);
    current.deliver({
      status: 'ok',
      retcode: 0,
      echo: current.lastCall().echo,
      data: { user_id: '20002' },
    });
    await vi.waitFor(() => expect(h.connection.connected).toBe(true));
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.sockets).toHaveLength(2);
    h.connection.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let rejection of the retired login RPC create another reconnect', async () => {
    const h = harness();
    const first = h.sockets[0]!;
    first.open();
    first.fail();
    first.close();
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sockets).toHaveLength(2);
    const current = h.sockets[1]!;
    current.open();
    current.deliver({ post_type: 'message', message: 'before identity' });
    expect(h.events).toHaveLength(0);
    expect(h.connection.connected).toBe(false);
    h.connection.stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.sockets).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a login result whose promise settles after stop', async () => {
    const h = harness();
    const socket = h.sockets[0]!;
    socket.open();
    socket.deliver({
      status: 'ok',
      retcode: 0,
      echo: socket.lastCall().echo,
      data: { user_id: '10001' },
    });
    h.connection.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.ready).toHaveLength(0);
    expect(h.states).not.toContain('online');
    expect(h.connection.connected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses a duplicate start rather than opening an unowned socket', () => {
    const h = harness();
    expect(() =>
      h.connection.start({
        ready: () => undefined,
        event: () => undefined,
        state: () => undefined,
      }),
    ).toThrow(OneBotError);
    expect(h.sockets).toHaveLength(1);
    h.connection.stop();
  });

  it('fails pending calls and reconnects after a drop', async () => {
    const h = harness();
    await h.login();
    const settled = expect(
      h.connection.call('send_private_msg', { user_id: '1' }),
    ).rejects.toMatchObject({ fault: 'gateway' });

    h.sockets[0]?.close();
    await settled;

    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.sockets.length).toBeGreaterThan(1);
  });

  it('refuses calls while offline and reports going offline on stop', async () => {
    const h = harness();
    await expect(h.connection.call('send_private_msg', {})).rejects.toMatchObject({
      fault: 'gateway',
    });

    await h.login();
    h.connection.stop();
    expect(h.states.at(-1)).toBe('offline');
    expect(h.sockets[0]?.terminated).toBe(1);
  });
});

const direct: SocialTarget = { platform: 'oopz', channelKind: 'direct', channelId: '20002' };
const group: SocialTarget = { platform: 'oopz', channelKind: 'group', channelId: '30003' };
const context = (id = '900'): SocialSendContext => ({
  replyToMessageId: id,
  signal: new AbortController().signal,
});

const adapterHarness = () => {
  let now = 1_800_000_000_000;
  let handlers: Parameters<OneBotConnection['start']>[0];
  const connection = {
    start: vi.fn((callbacks: Parameters<OneBotConnection['start']>[0]) => {
      handlers = callbacks;
      callbacks.state('online');
      callbacks.ready('10001');
    }),
    call: vi.fn(async () => ({ message_id: 77 })),
    stop: vi.fn(),
    connected: true,
  } as unknown as OneBotConnection;
  const adapter = new OneBotAdapter({
    url: URL_OK,
    createConnection: () => connection,
    now: () => now,
  });
  const messages: SocialMessage[] = [];
  adapter.onMessage((message) => messages.push(message));
  return {
    adapter,
    connection,
    messages,
    emit: (value: unknown) => handlers.event(value),
    advance: (ms: number) => {
      now += ms;
    },
  };
};

const inbound = (overrides: Record<string, unknown> = {}) => ({
  post_type: 'message',
  message_type: 'private',
  message_id: 900,
  user_id: 20002,
  message: '你好',
  sender: { user_id: 20002 },
  ...overrides,
});

describe('OneBot adapter', () => {
  it('declares itself as the oopz platform, text only', async () => {
    const h = adapterHarness();
    await h.adapter.connect();

    expect(h.adapter.platform).toBe('oopz');
    expect(h.adapter.capabilities).toEqual({
      text: true,
      audioMessage: false,
      voiceChannel: false,
      streamingText: false,
    });
  });

  it('answers a private message through the right action', async () => {
    const h = adapterHarness();
    await h.adapter.connect();
    h.emit(inbound());

    expect(h.messages).toHaveLength(1);
    await h.adapter.sendText(direct, '回复内容', context());

    expect(vi.mocked(h.connection.call)).toHaveBeenCalledWith('send_private_msg', {
      user_id: '20002',
      message: [{ type: 'text', data: { text: '回复内容' } }],
    });
  });

  it('stays silent in a group until it is addressed', async () => {
    const h = adapterHarness();
    await h.adapter.connect();

    h.emit(inbound({ message_type: 'group', group_id: 30003, message_id: 901 }));
    expect(h.messages).toHaveLength(0);

    h.emit(
      inbound({
        message_type: 'group',
        group_id: 30003,
        message_id: 902,
        message: '[CQ:at,qq=10001]在吗',
      }),
    );
    expect(h.messages).toHaveLength(1);
    await h.adapter.sendText(group, '在的', context('902'));
    expect(vi.mocked(h.connection.call).mock.calls[0]?.[0]).toBe('send_group_msg');
  });

  it('never sends unsolicited, expired or duplicated replies', async () => {
    const h = adapterHarness();
    await h.adapter.connect();

    await expect(h.adapter.sendText(direct, 'hi', context())).rejects.toThrow(
      'The OneBot reply window expired.',
    );

    h.emit(inbound());
    await h.adapter.sendText(direct, 'first', context());
    await expect(h.adapter.sendText(direct, 'second', context())).rejects.toThrow(
      'The OneBot reply window expired.',
    );

    h.emit(inbound({ message_id: 903 }));
    h.advance(180_000);
    await expect(h.adapter.sendText(direct, 'late', context('903'))).rejects.toThrow(
      'The OneBot reply window expired.',
    );
    expect(vi.mocked(h.connection.call)).toHaveBeenCalledTimes(1);
  });

  it('refuses a target the trigger did not come from', async () => {
    const h = adapterHarness();
    await h.adapter.connect();
    h.emit(inbound());

    await expect(
      h.adapter.sendText({ ...direct, channelId: '99999' }, 'hi', context()),
    ).rejects.toThrow('The OneBot reply window expired.');
    await expect(
      h.adapter.sendText(
        { platform: 'oopz', channelKind: 'channel', channelId: '20002' },
        'hi',
        context(),
      ),
    ).rejects.toThrow('OneBot reply is unavailable.');
    expect(vi.mocked(h.connection.call)).not.toHaveBeenCalled();
  });

  it('deduplicates redelivered events and bounds one sender', async () => {
    const h = adapterHarness();
    await h.adapter.connect();

    h.emit(inbound());
    h.emit(inbound());
    expect(h.messages).toHaveLength(1);

    for (let index = 0; index < 20; index += 1) h.emit(inbound({ message_id: 1_000 + index }));
    expect(h.messages).toHaveLength(12);
  });

  it('recognizes a quoted reply only after it actually sent that message', async () => {
    const h = adapterHarness();
    await h.adapter.connect();
    h.emit(inbound());
    await h.adapter.sendText(direct, '我之前说的', context());

    h.emit(inbound({ message_id: 904, message: '[CQ:reply,id=77]接着说' }));
    expect(h.messages.at(-1)?.repliesToCharacter).toBe(true);

    h.emit(inbound({ message_id: 905, message: '[CQ:reply,id=999]谁说的' }));
    expect(h.messages.at(-1)?.repliesToCharacter).toBe(false);
  });

  it('sanitizes a bridge failure instead of leaking it', async () => {
    const h = adapterHarness();
    await h.adapter.connect();
    vi.mocked(h.connection.call).mockRejectedValueOnce(
      new Error('bridge said: Authorization Bearer AAAAAAAAAAAAAAAAAAAAAAAA'),
    );
    h.emit(inbound());

    await expect(h.adapter.sendText(direct, 'hi', context())).rejects.toThrow(
      'OneBot could not send the reply.',
    );
  });

  it('clears its caches and stops the bridge connection on disconnect', async () => {
    const h = adapterHarness();
    await h.adapter.connect();
    h.emit(inbound());

    await h.adapter.disconnect();

    expect(h.connection.stop).toHaveBeenCalledTimes(1);
    await expect(h.adapter.sendText(direct, 'hi', context())).rejects.toThrow(
      'OneBot reply is unavailable.',
    );
  });
});
