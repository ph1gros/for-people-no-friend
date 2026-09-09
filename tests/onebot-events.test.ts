import { describe, expect, it } from 'vitest';

import {
  normalizeOneBotMessage,
  oneBotId,
  type OneBotQuote,
} from '../src/adapters/social/onebot/onebot-events';

const SELF = '10001';

const event = (overrides: Record<string, unknown> = {}) => ({
  post_type: 'message',
  message_type: 'private',
  message_id: 900,
  user_id: 20002,
  raw_message: '你好',
  message: '你好',
  sender: { user_id: 20002, nickname: 'Ann' },
  ...overrides,
});

const normalize = (
  overrides: Record<string, unknown> = {},
  findQuote: (targetId: string, quotedId: string) => OneBotQuote | undefined = () => undefined,
) => normalizeOneBotMessage(event(overrides), { selfId: SELF, now: 1_800_000_000_000, findQuote });

describe('OneBot identifiers', () => {
  it('accepts integers and safe strings, rejects everything else', () => {
    expect(oneBotId(123)).toBe('123');
    expect(oneBotId('abc-1')).toBe('abc-1');
    expect(oneBotId(-1)).toBeUndefined();
    expect(oneBotId(1.5)).toBeUndefined();
    expect(oneBotId('has space')).toBeUndefined();
    expect(oneBotId(null)).toBeUndefined();
  });
});

describe('OneBot event normalization', () => {
  it('maps a private message and treats it as addressed', () => {
    const message = normalize();

    expect(message).toMatchObject({
      messageId: '900',
      userId: '20002',
      displayName: 'Ann',
      text: '你好',
      mentionsCharacter: true,
    });
    expect(message?.target).toEqual({
      platform: 'oopz',
      channelKind: 'direct',
      channelId: '20002',
    });
  });

  it('maps a group message and requires an explicit mention', () => {
    const plain = normalize({ message_type: 'group', group_id: 30003 });
    expect(plain?.target).toEqual({
      platform: 'oopz',
      channelKind: 'group',
      channelId: '30003',
    });
    expect(plain?.mentionsCharacter).toBe(false);
  });

  it('recognizes a mention in CQ-code form and strips only its own marker', () => {
    const mentioned = normalize({
      message_type: 'group',
      group_id: 30003,
      message: `[CQ:at,qq=${SELF}] 在吗`,
    });
    expect(mentioned?.mentionsCharacter).toBe(true);
    expect(mentioned?.text).toBe('在吗');

    // Markup naming a third party stays literal and must not open the gate.
    const forged = normalize({
      message_type: 'group',
      group_id: 30003,
      message: '[CQ:at,qq=99999] 看这个',
    });
    expect(forged?.mentionsCharacter).toBe(false);
    expect(forged?.text).toContain('[CQ:at,qq=99999]');
  });

  it('recognizes a mention in segment form, including at-all', () => {
    const segments = normalize({
      message_type: 'group',
      group_id: 30003,
      message: [
        { type: 'at', data: { qq: SELF } },
        { type: 'text', data: { text: ' 早上好' } },
      ],
    });
    expect(segments?.mentionsCharacter).toBe(true);
    expect(segments?.text).toBe('早上好');

    const all = normalize({
      message_type: 'group',
      group_id: 30003,
      message: [
        { type: 'at', data: { qq: 'all' } },
        { type: 'text', data: { text: '通知' } },
      ],
    });
    expect(all?.mentionsCharacter).toBe(true);
  });

  it('drops non-text segments instead of leaking their payloads', () => {
    const message = normalize({
      message: [
        { type: 'image', data: { file: 'http://example.invalid/a.png' } },
        { type: 'text', data: { text: '看图' } },
      ],
    });

    expect(message?.text).toBe('看图');
    expect(JSON.stringify(message)).not.toContain('example.invalid');
  });

  it('only trusts a quote the character actually sent in that target', () => {
    const resolver = (targetId: string, quotedId: string) =>
      targetId === '20002' && quotedId === '555' ? { id: '555', text: '我之前说的' } : undefined;

    const cq = normalize({ message: '[CQ:reply,id=555]接着说' }, resolver);
    expect(cq?.repliesToCharacter).toBe(true);
    expect(cq?.replyToMessageId).toBe('555');
    expect(cq?.text).toContain('我之前说的');

    const segment = normalize(
      {
        message: [
          { type: 'reply', data: { id: 555 } },
          { type: 'text', data: { text: '嗯' } },
        ],
      },
      resolver,
    );
    expect(segment?.repliesToCharacter).toBe(true);

    const foreign = normalize({ message: '[CQ:reply,id=999]谁说的' }, resolver);
    expect(foreign?.repliesToCharacter).toBe(false);
  });

  it('prefers the group card over the nickname for display', () => {
    expect(
      normalize({
        message_type: 'group',
        group_id: 30003,
        message: `[CQ:at,qq=${SELF}]hi`,
        sender: { user_id: 20002, nickname: 'Ann', card: '阿安' },
      })?.displayName,
    ).toBe('阿安');
  });

  it('ignores non-message events, its own messages and unsupported chat kinds', () => {
    expect(normalize({ post_type: 'notice' })).toBeUndefined();
    expect(normalize({ post_type: 'meta_event' })).toBeUndefined();
    expect(normalize({ user_id: Number(SELF) })).toBeUndefined();
    expect(normalize({ message_type: 'guild' })).toBeUndefined();
    expect(
      normalizeOneBotMessage(null, { selfId: SELF, now: 1, findQuote: () => undefined }),
    ).toBeUndefined();
    expect(
      normalizeOneBotMessage([], { selfId: SELF, now: 1, findQuote: () => undefined }),
    ).toBeUndefined();
  });

  it('rejects malformed identifiers and oversized payloads', () => {
    expect(normalize({ user_id: 'bad id' })).toBeUndefined();
    expect(normalize({ message_id: -1 })).toBeUndefined();
    expect(normalize({ message_type: 'group', group_id: undefined })).toBeUndefined();
    expect(normalize({ message: 'x'.repeat(16_001) })).toBeUndefined();
    expect(
      normalize({
        message: Array.from({ length: 201 }, () => ({ type: 'text', data: { text: 'a' } })),
      }),
    ).toBeUndefined();
  });

  it('drops a message that is empty once its own mention markup is removed', () => {
    expect(
      normalize({ message_type: 'group', group_id: 30003, message: `[CQ:at,qq=${SELF}]` }),
    ).toBeUndefined();
    expect(normalize({ message: [{ type: 'image', data: {} }] })).toBeUndefined();
  });

  it('falls back to raw_message when no structured message is present', () => {
    const message = normalizeOneBotMessage(
      {
        post_type: 'message',
        message_type: 'private',
        message_id: 901,
        user_id: 20002,
        raw_message: '只有原始文本',
        sender: { user_id: 20002 },
      },
      { selfId: SELF, now: 1_800_000_000_000, findQuote: () => undefined },
    );

    expect(message?.text).toBe('只有原始文本');
  });
});
