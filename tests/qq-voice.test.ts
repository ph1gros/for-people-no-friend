import { describe, expect, it, vi } from 'vitest';

import { QqAdapter } from '../src/adapters/social/qq/qq-adapter';
import { normalizeQqMessage } from '../src/adapters/social/qq/qq-events';
import type { QqTransport } from '../src/adapters/social/qq/qq-transport';
import type {
  SocialAudioPayload,
  SocialSendContext,
  SocialTarget,
} from '../src/core/social/social-contracts';

const event = (overrides: Record<string, unknown> = {}) => ({
  rawEventType: 'C2C_MESSAGE_CREATE',
  kind: 'c2c',
  senderId: 'friend-openid',
  content: 'hello',
  messageId: 'message-1',
  timestamp: '2026-09-07T00:00:00Z',
  ...overrides,
});

const harness = (voiceEnabled: boolean) => {
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
    sendVoice: vi.fn(async () => ({ id: 'voice-1' })),
  };
  const adapter = new QqAdapter({
    appId: '123456',
    now: () => now,
    getCredentials: async () => ({ appId: '123456', appSecret: 'fake-secret-for-test' }),
    createTransport: async () => transport,
    voiceEnabled,
  });
  return {
    adapter,
    transport,
    emit: (value: unknown) => handlers.message(value),
    advance: (ms: number) => {
      now += ms;
    },
  };
};

const target: SocialTarget = { platform: 'qq', channelKind: 'direct', channelId: 'friend-openid' };
const clip = (): SocialAudioPayload => ({
  mimeType: 'audio/silk',
  data: Uint8Array.from([0x02, 0x23, 0x21, 0x53]),
  durationMs: 1_200,
});
const context = (id = 'message-1'): SocialSendContext => ({
  replyToMessageId: id,
  signal: new AbortController().signal,
});

describe('QQ native voice replies', () => {
  it('declares the capability only when the optional codec was confirmed', () => {
    expect(harness(false).adapter.capabilities.audioMessage).toBe(false);
    expect(harness(true).adapter.capabilities.audioMessage).toBe(true);
    expect(harness(true).adapter.capabilities.voiceChannel).toBe(false);
  });

  it('uploads and sends a voice note for a recent trigger', async () => {
    const h = harness(true);
    await h.adapter.connect();
    h.emit(event());

    await h.adapter.sendAudio(target, clip(), context());

    expect(h.transport.sendVoice).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.transport.sendVoice).mock.calls[0]?.[0]).toEqual({
      kind: 'c2c',
      id: 'friend-openid',
      messageId: 'message-1',
    });
    expect(vi.mocked(h.transport.sendVoice).mock.calls[0]?.[1]).toEqual(clip().data);
  });

  it('refuses to speak when the capability is off', async () => {
    const h = harness(false);
    await h.adapter.connect();
    h.emit(event());

    await expect(h.adapter.sendAudio(target, clip(), context())).rejects.toThrow(
      'QQ voice reply is unavailable.',
    );
    expect(h.transport.sendVoice).not.toHaveBeenCalled();
  });

  it('rejects a payload that is not SILK', async () => {
    const h = harness(true);
    await h.adapter.connect();
    h.emit(event());

    await expect(
      h.adapter.sendAudio(target, { ...clip(), mimeType: 'audio/wav' }, context()),
    ).rejects.toThrow('The QQ voice reply is invalid.');
    await expect(
      h.adapter.sendAudio(target, { ...clip(), data: new Uint8Array(0) }, context()),
    ).rejects.toThrow('The QQ voice reply is invalid.');
    expect(h.transport.sendVoice).not.toHaveBeenCalled();
  });

  it('never sends unsolicited, expired or duplicated voice notes', async () => {
    const h = harness(true);
    await h.adapter.connect();

    // No trigger at all.
    await expect(h.adapter.sendAudio(target, clip(), context())).rejects.toThrow(
      'The QQ reply window expired.',
    );

    h.emit(event());
    await h.adapter.sendAudio(target, clip(), context());
    // The trigger is consumed, so a second clip cannot ride on the same message.
    await expect(h.adapter.sendAudio(target, clip(), context())).rejects.toThrow(
      'The QQ reply window expired.',
    );

    h.emit(event({ messageId: 'message-2' }));
    h.advance(180_000);
    await expect(h.adapter.sendAudio(target, clip(), context('message-2'))).rejects.toThrow(
      'The QQ reply window expired.',
    );
    expect(h.transport.sendVoice).toHaveBeenCalledTimes(1);
  });

  it('refuses a target the trigger did not come from', async () => {
    const h = harness(true);
    await h.adapter.connect();
    h.emit(event());

    await expect(
      h.adapter.sendAudio({ ...target, channelId: 'other-openid' }, clip(), context()),
    ).rejects.toThrow('The QQ reply window expired.');
    await expect(
      h.adapter.sendAudio(
        { platform: 'qq', channelKind: 'channel', channelId: 'guild-channel' },
        clip(),
        context(),
      ),
    ).rejects.toThrow('QQ voice reply is unavailable.');
    expect(h.transport.sendVoice).not.toHaveBeenCalled();
  });

  it('requires an online transport and an explicit context', async () => {
    const h = harness(true);
    await expect(h.adapter.sendAudio(target, clip(), context())).rejects.toThrow(
      'QQ voice reply is unavailable.',
    );

    await h.adapter.connect();
    h.emit(event());
    await expect(h.adapter.sendAudio(target, clip())).rejects.toThrow(
      'QQ voice reply is unavailable.',
    );
  });

  it('sanitizes a transport failure instead of leaking it', async () => {
    const h = harness(true);
    vi.mocked(h.transport.sendVoice).mockRejectedValueOnce(
      new Error('Authorization: Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
    );
    await h.adapter.connect();
    h.emit(event());

    await expect(h.adapter.sendAudio(target, clip(), context())).rejects.toThrow(
      'QQ could not send the voice reply.',
    );
  });
});

const inbound = (overrides: Record<string, unknown> = {}) =>
  normalizeQqMessage(
    {
      rawEventType: 'C2C_MESSAGE_CREATE',
      kind: 'c2c',
      senderId: 'friend-openid',
      content: '',
      messageId: 'voice-1',
      timestamp: '2026-09-07T00:00:00Z',
      ...overrides,
    },
    { appId: '123456', selfUserId: 'bot', now: 1_800_000_000_000, findQuote: () => undefined },
  );

const voiceAttachment = (overrides: Record<string, unknown> = {}) => [
  {
    content_type: 'voice',
    url: 'https://example.invalid/a.silk',
    asr_refer_text: '你好',
    ...overrides,
  },
];

describe('QQ inbound voice notes', () => {
  it('answers a voice note using the transcript QQ already produced', () => {
    const message = inbound({ attachments: voiceAttachment() });

    expect(message?.text).toBe('[语音消息]\n你好');
    expect(message?.audio).toBeUndefined();
  });

  it('accepts an audio mime type as well as the voice marker', () => {
    expect(inbound({ attachments: voiceAttachment({ content_type: 'audio/silk' }) })?.text).toBe(
      '[语音消息]\n你好',
    );
  });

  it('drops a voice note the platform could not transcribe', () => {
    expect(
      inbound({ attachments: voiceAttachment({ asr_refer_text: undefined }) }),
    ).toBeUndefined();
    expect(inbound({ attachments: voiceAttachment({ asr_refer_text: '   ' }) })).toBeUndefined();
    expect(inbound({ attachments: voiceAttachment({ asr_refer_text: 42 }) })).toBeUndefined();
  });

  it('ignores transcripts on non-voice attachments', () => {
    expect(
      inbound({
        attachments: [
          {
            content_type: 'image/png',
            url: 'https://example.invalid/a.png',
            asr_refer_text: '不该被读',
          },
        ],
      }),
    ).toBeUndefined();
  });

  it('prefers real text when the message carries both', () => {
    expect(inbound({ content: '打字的内容', attachments: voiceAttachment() })?.text).toBe(
      '打字的内容',
    );
  });

  it('rejects an oversized transcript and an oversized attachment list', () => {
    expect(
      inbound({ attachments: voiceAttachment({ asr_refer_text: 'x'.repeat(16_001) }) }),
    ).toBeUndefined();
    expect(
      inbound({
        attachments: Array.from({ length: 21 }, () => voiceAttachment()[0]),
      }),
    ).toBeUndefined();
  });

  it('never carries the raw audio URL into the conversation core', () => {
    const message = inbound({ attachments: voiceAttachment() });

    expect(JSON.stringify(message)).not.toContain('example.invalid');
  });

  it('still requires a mention for a group voice note', () => {
    expect(
      inbound({
        kind: 'group',
        rawEventType: 'GROUP_MESSAGE_CREATE',
        groupOpenid: 'group-1',
        attachments: voiceAttachment(),
      })?.mentionsCharacter,
    ).toBe(false);
    expect(
      inbound({
        kind: 'group',
        rawEventType: 'GROUP_AT_MESSAGE_CREATE',
        groupOpenid: 'group-1',
        attachments: voiceAttachment(),
      })?.mentionsCharacter,
    ).toBe(true);
  });
});
