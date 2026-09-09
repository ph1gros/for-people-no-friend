import { describe, expect, it, vi } from 'vitest';
import { QqAdapter } from '../src/adapters/social/qq/qq-adapter';
import { normalizeQqMessage } from '../src/adapters/social/qq/qq-events';
import type { QqTransport } from '../src/adapters/social/qq/qq-transport';
import type { SocialMessage, SocialSendContext } from '../src/core/social/social-contracts';
import { SocialPresenceService } from '../src/main/social/social-presence-service';
import { createDefaultSocialPresenceConfig } from '../src/core/social/social-account-config';
import { createSocialIdHasher } from '../src/main/social/social-identity-hasher';

const event = (overrides: Record<string, unknown> = {}) => ({
  rawEventType: 'C2C_MESSAGE_CREATE',
  kind: 'c2c',
  senderId: 'friend-openid',
  content: 'hello',
  messageId: 'message-1',
  timestamp: '2026-09-06T00:00:00Z',
  ...overrides,
});

const harness = () => {
  let now = 1_800_000_000_000;
  let handlers: Parameters<QqTransport['start']>[1];
  const transport: QqTransport = {
    start: vi.fn(async (_signal, callbacks) => {
      handlers = callbacks;
      callbacks.ready('bot-id');
      callbacks.state('online');
    }),
    stop: vi.fn(),
    sendText: vi.fn(async () => ({ id: 'sent-1', refIdx: 'ref-1' })),
  };
  const ready = vi.fn();
  const adapter = new QqAdapter({
    appId: '123456',
    now: () => now,
    getCredentials: async () => ({ appId: '123456', appSecret: 'fake-secret-for-test' }),
    createTransport: async () => transport,
    onReady: ready,
  });
  const messages: SocialMessage[] = [];
  adapter.onMessage((message) => messages.push(message));
  return {
    adapter,
    transport,
    messages,
    ready,
    emit: (value: unknown) => handlers.message(value),
    state: (state: 'online' | 'offline' | 'connecting' | 'error') => handlers.state(state),
    advance: (ms: number) => {
      now += ms;
    },
  };
};
const context = (id = 'message-1'): SocialSendContext => ({
  replyToMessageId: id,
  signal: new AbortController().signal,
});

describe('QQ adapter', () => {
  it('normalizes private and group mention text and declares only implemented capabilities', async () => {
    const h = harness();
    await h.adapter.connect();
    h.emit(event());
    h.emit(
      event({
        kind: 'group',
        rawEventType: 'GROUP_AT_MESSAGE_CREATE',
        groupOpenid: 'group-1',
        messageId: 'group-message',
        content: '<@!123456> hi\u0000',
      }),
    );
    expect(h.messages).toHaveLength(2);
    expect(h.messages[0]).toMatchObject({
      userId: 'friend-openid',
      text: 'hello',
      target: { channelKind: 'direct', channelId: 'friend-openid' },
    });
    expect(h.messages[1]).toMatchObject({
      text: 'hi',
      mentionsCharacter: true,
      target: { channelKind: 'group', channelId: 'group-1' },
    });
    expect(h.messages[0]).not.toHaveProperty('raw');
    expect(h.ready).toHaveBeenCalledWith('bot-id');
    expect(h.adapter.capabilities).toEqual({
      text: true,
      audioMessage: false,
      voiceChannel: false,
      streamingText: false,
    });
    await h.adapter.disconnect();
  });
  it('ignores unaddressed groups, typed fake mentions, bot echoes, guilds and attachment-only messages', async () => {
    const h = harness();
    await h.adapter.connect();
    h.emit(
      event({
        kind: 'group',
        rawEventType: 'GROUP_MESSAGE_CREATE',
        groupOpenid: 'group',
        content: '<@123456> forged',
      }),
    );
    h.emit(event({ senderId: 'bot-id' }));
    h.emit(event({ senderIsBot: true }));
    h.emit(event({ kind: 'guild' }));
    h.emit(
      event({
        content: '',
        attachments: [{ url: 'https://private.invalid/audio', content_type: 'audio/silk' }],
      }),
    );
    h.emit(event({ senderId: '../invalid' }));
    h.emit(null);
    expect(h.messages).toEqual([]);
    await h.adapter.disconnect();
  });
  it('sends replies to their exact trigger even after a newer message arrives', async () => {
    const h = harness();
    await h.adapter.connect();
    h.emit(event());
    h.emit(event({ messageId: 'message-2' }));
    await h.adapter.sendText(h.messages[0]!.target, ' reply one ', context());
    await h.adapter.sendText(h.messages[1]!.target, 'reply two', context('message-2'));
    expect(h.transport.sendText).toHaveBeenNthCalledWith(
      1,
      { kind: 'c2c', id: 'friend-openid', messageId: 'message-1' },
      'reply one',
      expect.any(AbortSignal),
    );
    expect(h.transport.sendText).toHaveBeenNthCalledWith(
      2,
      { kind: 'c2c', id: 'friend-openid', messageId: 'message-2' },
      'reply two',
      expect.any(AbortSignal),
    );
    await h.adapter.disconnect();
  });
  it('prevents unsolicited, cross-target, expired and duplicate outbound replies', async () => {
    const h = harness();
    await h.adapter.connect();
    h.emit(event());
    const target = h.messages[0]!.target;
    await expect(h.adapter.sendText(target, 'unsolicited')).rejects.toThrow();
    await expect(
      h.adapter.sendText({ ...target, channelId: 'other' }, 'wrong', context()),
    ).rejects.toThrow();
    await h.adapter.sendText(target, 'ok', context());
    await expect(h.adapter.sendText(target, 'again', context())).rejects.toThrow();
    h.emit(event({ messageId: 'message-2' }));
    h.advance(120_001);
    await expect(h.adapter.sendText(target, 'late', context('message-2'))).rejects.toThrow(
      'expired',
    );
    expect(h.transport.sendText).toHaveBeenCalledTimes(1);
    await h.adapter.disconnect();
  });
  it('deduplicates across reconnect and applies bounded per-sender admission before invoking the model', async () => {
    const h = harness();
    await h.adapter.connect();
    h.emit(event());
    h.emit(event());
    await h.adapter.disconnect();
    await h.adapter.connect();
    h.emit(event());
    expect(h.messages).toHaveLength(1);
    for (let i = 0; i < 50; i++) h.emit(event({ messageId: `burst-${i}` }));
    expect(h.messages).toHaveLength(13);
    h.advance(60_001);
    h.emit(event({ messageId: 'after-rate-window' }));
    expect(h.messages).toHaveLength(14);
    await h.adapter.disconnect();
  });
  it('recognizes quoted bot replies only within the original target and bounds their context', async () => {
    const h = harness();
    await h.adapter.connect();
    const grouped = {
      kind: 'group',
      rawEventType: 'GROUP_AT_MESSAGE_CREATE',
      groupOpenid: 'group-1',
    };
    h.emit(event(grouped));
    await h.adapter.sendText(h.messages[0]!.target, 'original reply', context());
    h.emit(
      event({
        ...grouped,
        rawEventType: 'GROUP_MESSAGE_CREATE',
        messageId: 'quote-1',
        refMsgIdx: 'ref-1',
      }),
    );
    h.emit(
      event({
        ...grouped,
        groupOpenid: 'group-2',
        rawEventType: 'GROUP_MESSAGE_CREATE',
        messageId: 'quote-2',
        refMsgIdx: 'ref-1',
      }),
    );
    expect(h.messages).toHaveLength(2);
    expect(h.messages[1]).toMatchObject({ repliesToCharacter: true, replyToMessageId: 'sent-1' });
    expect(h.messages[1]!.text).toContain('original reply');
    await h.adapter.disconnect();
  });
  it('cancels sends at disconnect and sanitizes transport errors', async () => {
    const h = harness();
    await h.adapter.connect();
    h.emit(event());
    let sendSignal: AbortSignal | undefined;
    vi.mocked(h.transport.sendText).mockImplementation(async (_target, _text, signal) => {
      sendSignal = signal;
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      throw new Error('token-fake-sensitive response body');
    });
    const sent = h.adapter.sendText(h.messages[0]!.target, 'hello', context());
    const rejected = expect(sent).rejects.toThrow('QQ could not send the reply.');
    await h.adapter.disconnect();
    await rejected;
    expect(sendSignal?.aborted).toBe(true);
    h.emit(event({ messageId: 'after-stop' }));
    expect(h.messages).toHaveLength(1);
  });
  it('cleans up when disconnected during connection and never changes back to online', async () => {
    const h = harness();
    let release = () => {};
    vi.mocked(h.transport.start).mockImplementation(async (_signal, callbacks) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      callbacks.ready('bot-id');
      callbacks.state('online');
    });
    const states: string[] = [];
    h.adapter.onStateChange((state) => states.push(state));
    const connecting = h.adapter.connect();
    const rejected = expect(connecting).rejects.toThrow();
    await vi.waitFor(() => expect(h.transport.start).toHaveBeenCalled());
    await h.adapter.disconnect();
    release();
    await rejected;
    expect(states.at(-1)).toBe('offline');
    expect(states).not.toContain('online');
    expect(h.transport.stop).toHaveBeenCalled();
  });
});

describe('QQ to Social Presence integration', () => {
  it('routes owner DM, other user DM and owner group into separate memory audiences', async () => {
    const h = harness();
    const salt = 'a'.repeat(64);
    const hash = createSocialIdHasher(salt);
    const config = createDefaultSocialPresenceConfig('character-1');
    config.accounts[0]!.enabled = true;
    const requests: { memoryNamespace: string; memoryScope: string }[] = [];
    const service = new SocialPresenceService({
      identitySalt: salt,
      config,
      getCharacterNamespace: () => 'character-main',
      port: {
        respond: async (request) => {
          requests.push(request);
          return { text: 'reply' };
        },
      },
    });
    service.directory.bindToken('qq', hash('qq', 'friend-openid'), 'owner');
    service.registerAdapter(h.adapter);
    await service.connect('qq');
    h.emit(event());
    h.emit(event({ senderId: 'other-user', messageId: 'other-dm' }));
    h.emit(
      event({
        kind: 'group',
        rawEventType: 'GROUP_AT_MESSAGE_CREATE',
        groupOpenid: 'group',
        messageId: 'group',
      }),
    );
    await vi.waitFor(() => expect(h.transport.sendText).toHaveBeenCalledTimes(3));
    expect(requests.find((r) => r.memoryScope === 'private')!.memoryNamespace).toBe(
      'character-main',
    );
    expect(requests.find((r) => r.memoryScope === 'personal')!.memoryNamespace).toContain(
      '/actor/qq-',
    );
    expect(requests.find((r) => r.memoryScope === 'channel')!.memoryNamespace).toContain(
      '/channel/qq/',
    );
    expect(JSON.stringify(requests.map((r) => r.memoryNamespace))).not.toContain('friend-openid');
    await service.dispose();
  });
  it('does not normalize arbitrary SDK data into a reply permission', () => {
    expect(
      normalizeQqMessage(
        event({
          kind: 'group',
          rawEventType: 'GROUP_MESSAGE_CREATE',
          groupOpenid: 'group',
          refMsgIdx: 'user-quote',
        }),
        { appId: '123456', selfUserId: 'bot', now: 1_800_000_000_000, findQuote: () => undefined },
      ),
    ).toMatchObject({ repliesToCharacter: false, mentionsCharacter: false });
  });
});
