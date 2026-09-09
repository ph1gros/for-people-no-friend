import { describe, expect, it } from 'vitest';

import { normalizeKookMessage, type KookQuote } from '../src/adapters/social/kook/kook-events';

const SELF = 'bot-user-id';

const event = (overrides: Record<string, unknown> = {}) => ({
  channel_type: 'PERSON',
  type: 1,
  target_id: 'peer-1',
  author_id: 'friend-1',
  content: '你好',
  msg_id: 'msg-1',
  msg_timestamp: 1_800_000_000_000,
  extra: { author: { id: 'friend-1', username: 'Ann' } },
  ...overrides,
});

const normalize = (
  overrides: Record<string, unknown> = {},
  findQuote: (targetId: string, quotedId: string) => KookQuote | undefined = () => undefined,
) =>
  normalizeKookMessage(event(overrides), { selfUserId: SELF, now: 1_800_000_000_000, findQuote });

describe('KOOK event normalization', () => {
  it('maps a direct message and always treats it as addressed', () => {
    const message = normalize();

    expect(message).toMatchObject({
      messageId: 'msg-1',
      userId: 'friend-1',
      displayName: 'Ann',
      text: '你好',
      mentionsCharacter: true,
    });
    expect(message?.target).toEqual({
      platform: 'kook',
      channelKind: 'direct',
      channelId: 'peer-1',
    });
  });

  it('maps a guild message to a channel target carrying its server', () => {
    const message = normalize({
      channel_type: 'GROUP',
      target_id: 'channel-9',
      extra: { guild_id: 'guild-3', author: { id: 'friend-1', nickname: '阿安' } },
    });

    expect(message?.target).toEqual({
      platform: 'kook',
      channelKind: 'channel',
      channelId: 'channel-9',
      serverId: 'guild-3',
    });
    expect(message?.displayName).toBe('阿安');
    expect(message?.mentionsCharacter).toBe(false);
  });

  it('recognizes a real mention and mention-all, but not typed markup for someone else', () => {
    const mentioned = normalize({
      channel_type: 'GROUP',
      target_id: 'channel-9',
      content: `(met)${SELF}(met) 在吗`,
      extra: { guild_id: 'g', mention: [SELF], author: { id: 'friend-1' } },
    });
    expect(mentioned?.mentionsCharacter).toBe(true);
    expect(mentioned?.text).toBe('在吗');

    const all = normalize({
      channel_type: 'GROUP',
      target_id: 'channel-9',
      extra: { guild_id: 'g', mention_all: true, author: { id: 'friend-1' } },
    });
    expect(all?.mentionsCharacter).toBe(true);

    // Markup naming a third party must stay literal text and must not open the gate.
    const forged = normalize({
      channel_type: 'GROUP',
      target_id: 'channel-9',
      content: '(met)999999(met) 看这个',
      extra: { guild_id: 'g', author: { id: 'friend-1' } },
    });
    expect(forged?.mentionsCharacter).toBe(false);
    expect(forged?.text).toBe('(met)999999(met) 看这个');
  });

  it('only trusts a quote the character actually sent in that target', () => {
    const quoted = normalize(
      { extra: { author: { id: 'friend-1' }, quote: { id: 'earlier-1' } } },
      (targetId, quotedId) =>
        targetId === 'peer-1' && quotedId === 'earlier-1'
          ? { id: 'earlier-1', text: '我之前说的' }
          : undefined,
    );

    expect(quoted?.repliesToCharacter).toBe(true);
    expect(quoted?.replyToMessageId).toBe('earlier-1');
    expect(quoted?.text).toContain('我之前说的');
    expect(quoted?.text).toContain('你好');

    const foreign = normalize({
      extra: { author: { id: 'friend-1' }, quote: { id: 'someone-else' } },
    });
    expect(foreign?.repliesToCharacter).toBe(false);
    expect(foreign?.replyToMessageId).toBeUndefined();
  });

  it('ignores bots, itself, non-text types and unsupported channel kinds', () => {
    expect(normalize({ extra: { author: { id: 'x', bot: true } } })).toBeUndefined();
    expect(normalize({ author_id: SELF })).toBeUndefined();
    expect(normalize({ type: 2 })).toBeUndefined();
    expect(normalize({ type: 10 })).toBeUndefined();
    expect(normalize({ channel_type: 'BROADCAST' })).toBeUndefined();
    expect(
      normalizeKookMessage(null, { selfUserId: SELF, now: 1, findQuote: () => undefined }),
    ).toBeUndefined();
  });

  it('rejects malformed identifiers and oversized content', () => {
    expect(normalize({ author_id: 'bad id' })).toBeUndefined();
    expect(normalize({ msg_id: '' })).toBeUndefined();
    expect(normalize({ target_id: 42 })).toBeUndefined();
    expect(normalize({ content: 'x'.repeat(16_001) })).toBeUndefined();
  });

  it('drops a message that is empty once self-mention markup is removed', () => {
    expect(
      normalize({
        channel_type: 'GROUP',
        target_id: 'channel-9',
        content: `(met)${SELF}(met)`,
        extra: { guild_id: 'g', mention: [SELF], author: { id: 'friend-1' } },
      }),
    ).toBeUndefined();
  });

  it('accepts KMarkdown as well as plain text', () => {
    expect(normalize({ type: 9, content: '**粗体**' })?.text).toBe('**粗体**');
  });
});
