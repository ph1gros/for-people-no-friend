import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

it('keeps KOOK sources textual while retaining escaped NUL key separators', () => {
  for (const file of [
    'src/adapters/social/kook/kook-adapter.ts',
    'tests/kook-presence-config.test.ts',
  ]) {
    const source = readFileSync(file, 'utf8');
    expect(source).not.toContain(String.fromCharCode(0));
    expect(source).toContain('\\u0000');
  }
});

import { KookAdapter } from '../src/adapters/social/kook/kook-adapter';
import type { KookTransport } from '../src/adapters/social/kook/kook-transport';
import type {
  SocialConnectionState,
  SocialMessage,
  SocialSendContext,
  SocialTarget,
} from '../src/core/social/social-contracts';

const SELF = 'bot-user-id';

const event = (overrides: Record<string, unknown> = {}) => ({
  channel_type: 'PERSON',
  type: 1,
  target_id: 'peer-1',
  author_id: 'friend-1',
  content: '你好',
  msg_id: 'msg-1',
  extra: { author: { id: 'friend-1', username: 'Ann' } },
  ...overrides,
});

const harness = () => {
  let now = 1_800_000_000_000;
  let handlers: Parameters<KookTransport['start']>[1];
  const transport: KookTransport = {
    start: vi.fn(async (_signal, callbacks) => {
      handlers = callbacks;
      callbacks.ready(SELF);
      callbacks.state('online');
    }),
    sendText: vi.fn(async () => ({ id: 'sent-1' })),
    stop: vi.fn(),
  };
  const adapter = new KookAdapter({
    getToken: async () => 'fake-kook-token-for-tests',
    createTransport: () => transport,
    now: () => now,
  });
  const messages: SocialMessage[] = [];
  const states: SocialConnectionState[] = [];
  adapter.onMessage((message) => messages.push(message));
  adapter.onStateChange((state) => states.push(state));
  return {
    adapter,
    transport,
    messages,
    states,
    emit: (value: unknown) => handlers.message(value),
    signal: (state: 'online' | 'offline' | 'connecting' | 'error') => handlers.state(state),
    advance: (ms: number) => {
      now += ms;
    },
  };
};

const direct: SocialTarget = { platform: 'kook', channelKind: 'direct', channelId: 'peer-1' };
const channel: SocialTarget = {
  platform: 'kook',
  channelKind: 'channel',
  channelId: 'channel-9',
  serverId: 'guild-3',
};
const context = (id = 'msg-1'): SocialSendContext => ({
  replyToMessageId: id,
  signal: new AbortController().signal,
});

describe('KOOK adapter', () => {
  it('connects, reports presence and declares only implemented capabilities', async () => {
    const h = harness();
    await h.adapter.connect();

    expect(h.adapter.capabilities).toEqual({
      text: true,
      audioMessage: false,
      voiceChannel: false,
      streamingText: false,
    });
    expect(h.states).toEqual(['connecting', 'online']);
  });

  it('forwards a direct message and answers within the reply window', async () => {
    const h = harness();
    await h.adapter.connect();
    h.emit(event());

    expect(h.messages).toHaveLength(1);
    await h.adapter.sendText(direct, '回复内容', context());

    expect(h.transport.sendText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.transport.sendText).mock.calls[0]?.[0]).toEqual({
      kind: 'direct',
      id: 'peer-1',
    });
  });

  it('stays silent in a channel until it is addressed', async () => {
    const h = harness();
    await h.adapter.connect();

    h.emit(
      event({
        channel_type: 'GROUP',
        target_id: 'channel-9',
        msg_id: 'unaddressed',
        extra: { guild_id: 'guild-3', author: { id: 'friend-1' } },
      }),
    );
    expect(h.messages).toHaveLength(0);

    h.emit(
      event({
        channel_type: 'GROUP',
        target_id: 'channel-9',
        msg_id: 'addressed',
        extra: { guild_id: 'guild-3', mention: [SELF], author: { id: 'friend-1' } },
      }),
    );
    expect(h.messages).toHaveLength(1);
    await h.adapter.sendText(channel, '收到', context('addressed'));
    expect(vi.mocked(h.transport.sendText).mock.calls[0]?.[0]).toEqual({
      kind: 'channel',
      id: 'channel-9',
    });
  });

  it('never sends unsolicited, expired or duplicated replies', async () => {
    const h = harness();
    await h.adapter.connect();

    await expect(h.adapter.sendText(direct, 'hi', context())).rejects.toThrow(
      'The KOOK reply window expired.',
    );

    h.emit(event());
    await h.adapter.sendText(direct, 'first', context());
    await expect(h.adapter.sendText(direct, 'second', context())).rejects.toThrow(
      'The KOOK reply window expired.',
    );

    h.emit(event({ msg_id: 'msg-2' }));
    h.advance(180_000);
    await expect(h.adapter.sendText(direct, 'late', context('msg-2'))).rejects.toThrow(
      'The KOOK reply window expired.',
    );
    expect(h.transport.sendText).toHaveBeenCalledTimes(1);
  });

  it('refuses a target the trigger did not come from', async () => {
    const h = harness();
    await h.adapter.connect();
    h.emit(event());

    await expect(
      h.adapter.sendText({ ...direct, channelId: 'other-peer' }, 'hi', context()),
    ).rejects.toThrow('The KOOK reply window expired.');
    await expect(
      h.adapter.sendText(
        { platform: 'kook', channelKind: 'group', channelId: 'peer-1' },
        'hi',
        context(),
      ),
    ).rejects.toThrow('KOOK reply is unavailable.');
    expect(h.transport.sendText).not.toHaveBeenCalled();
  });

  it('drops a redelivered gateway event', async () => {
    const h = harness();
    await h.adapter.connect();

    h.emit(event());
    h.emit(event());

    expect(h.messages).toHaveLength(1);
  });

  it('recognizes a quoted reply only after it actually sent that message', async () => {
    const h = harness();
    await h.adapter.connect();
    h.emit(event());
    await h.adapter.sendText(direct, '我之前说的', context());

    h.emit(
      event({ msg_id: 'msg-3', extra: { author: { id: 'friend-1' }, quote: { id: 'sent-1' } } }),
    );

    const quoted = h.messages.at(-1);
    expect(quoted?.repliesToCharacter).toBe(true);
    expect(quoted?.text).toContain('我之前说的');

    h.emit(
      event({
        msg_id: 'msg-4',
        extra: { author: { id: 'friend-1' }, quote: { id: 'never-sent' } },
      }),
    );
    expect(h.messages.at(-1)?.repliesToCharacter).toBe(false);
  });

  it('applies a bounded per-sender admission', async () => {
    const h = harness();
    await h.adapter.connect();

    for (let index = 0; index < 20; index += 1) {
      h.emit(event({ msg_id: `flood-${index}` }));
    }
    expect(h.messages).toHaveLength(12);

    h.advance(61_000);
    h.emit(event({ msg_id: 'after-window' }));
    expect(h.messages).toHaveLength(13);
  });

  it('requires an explicit context and an online transport', async () => {
    const h = harness();
    await expect(h.adapter.sendText(direct, 'hi', context())).rejects.toThrow(
      'KOOK reply is unavailable.',
    );

    await h.adapter.connect();
    h.emit(event());
    await expect(h.adapter.sendText(direct, 'hi')).rejects.toThrow('KOOK reply is unavailable.');
  });

  it('sanitizes a transport failure instead of leaking it', async () => {
    const h = harness();
    vi.mocked(h.transport.sendText).mockRejectedValueOnce(
      new Error('Authorization: Bot AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
    );
    await h.adapter.connect();
    h.emit(event());

    await expect(h.adapter.sendText(direct, 'hi', context())).rejects.toThrow(
      'KOOK could not send the reply.',
    );
  });

  it('clears its caches and stops the transport on disconnect', async () => {
    const h = harness();
    await h.adapter.connect();
    h.emit(event());

    await h.adapter.disconnect();

    expect(h.transport.stop).toHaveBeenCalledTimes(1);
    expect(h.states.at(-1)).toBe('offline');
    await expect(h.adapter.sendText(direct, 'hi', context())).rejects.toThrow(
      'KOOK reply is unavailable.',
    );
  });

  it('ignores gateway events that arrive before the session is identified', () => {
    const adapter = new KookAdapter({
      getToken: async () => 'fake-kook-token-for-tests',
      createTransport: () => ({
        start: vi.fn(async () => undefined),
        sendText: vi.fn(async () => ({ id: 'x' })),
        stop: vi.fn(),
      }),
    });
    const seen: SocialMessage[] = [];
    adapter.onMessage((message) => seen.push(message));

    expect(seen).toHaveLength(0);
  });
});
