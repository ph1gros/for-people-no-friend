import type { SocialMessage } from '../../../core/social/social-contracts';
import { parseSocialMessage } from '../../../core/social/social-message';
import { isKookId, kookRecord } from './kook-http';

/** Plain text and KMarkdown only. Images, cards, files and system events are ignored. */
const TEXT_MESSAGE_TYPES = new Set([1, 9]);
const MAX_CONTENT_LENGTH = 16_000;
const MAX_MENTIONS = 100;

export interface KookQuote {
  id: string;
  text: string;
}

export interface KookNormalizeOptions {
  selfUserId: string;
  now: number;
  /** Resolves a quoted message ID to one this character actually sent in that same target. */
  findQuote: (targetId: string, quotedId: string) => KookQuote | undefined;
}

/**
 * KMarkdown carries mention markup such as `(met)12345(met)` and role/channel variants. Markup
 * pointing at this character is stripped once it has been used for the reply gate; markup naming
 * anyone else is left as literal text so a user cannot forge a mention by typing one.
 */
const stripSelfMentions = (content: string, selfUserId: string): string =>
  content
    .replace(/\(met\)([A-Za-z0-9_-]{1,64})\(met\)/gu, (marker, id: string) =>
      id === selfUserId || id === 'all' || id === 'here' ? '' : marker,
    )
    .trim();

const mentionsSelf = (extra: Record<string, unknown>, selfUserId: string): boolean => {
  if (extra.mention_all === true || extra.mention_here === true) return true;
  const mention = extra.mention;
  if (!Array.isArray(mention) || mention.length > MAX_MENTIONS) return false;
  return mention.some((entry) => entry === selfUserId);
};

/**
 * Narrows a KOOK gateway event into a `SocialMessage`. Guild messages become `channel` targets so
 * memory stays scoped per channel; direct messages become `direct`.
 */
export const normalizeKookMessage = (
  value: unknown,
  options: KookNormalizeOptions,
): SocialMessage | undefined => {
  const event = kookRecord(value);
  const channelType = event.channel_type;
  if (channelType !== 'GROUP' && channelType !== 'PERSON') return undefined;
  if (typeof event.type !== 'number' || !TEXT_MESSAGE_TYPES.has(event.type)) return undefined;

  const authorId = event.author_id;
  const messageId = event.msg_id;
  const targetId = event.target_id;
  if (
    !isKookId(authorId) ||
    !isKookId(messageId) ||
    !isKookId(targetId) ||
    authorId === options.selfUserId ||
    typeof event.content !== 'string' ||
    event.content.length > MAX_CONTENT_LENGTH
  ) {
    return undefined;
  }

  const extra = kookRecord(event.extra);
  const author = kookRecord(extra.author);
  // The platform marks bots explicitly; never answer one, including a second copy of ourselves.
  if (author.bot === true) return undefined;

  const mentionsCharacter = channelType === 'PERSON' || mentionsSelf(extra, options.selfUserId);
  const text = stripSelfMentions(event.content, options.selfUserId);

  const quoted = kookRecord(extra.quote);
  const quote = isKookId(quoted.id) ? options.findQuote(targetId, quoted.id) : undefined;
  const body = quote
    ? `[引用角色此前的回复]\n${quote.text.slice(0, 1_000)}\n[当前消息]\n${text.slice(0, 2_900)}`
    : text;
  if (!body) return undefined;

  const displayName = author.nickname ?? author.username;
  const guildId = extra.guild_id;

  try {
    return parseSocialMessage({
      messageId,
      target: {
        platform: 'kook',
        channelKind: channelType === 'PERSON' ? 'direct' : 'channel',
        channelId: targetId,
        ...(channelType === 'GROUP' && isKookId(guildId) ? { serverId: guildId } : {}),
      },
      userId: authorId,
      ...(typeof displayName === 'string' ? { displayName } : {}),
      text: body,
      mentionsCharacter,
      repliesToCharacter: quote !== undefined,
      ...(quote ? { replyToMessageId: quote.id } : {}),
      receivedAt: options.now,
    });
  } catch {
    return undefined;
  }
};
