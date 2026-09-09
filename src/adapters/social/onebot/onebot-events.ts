import { SOCIAL_ID_PATTERN, type SocialMessage } from '../../../core/social/social-contracts';
import { parseSocialMessage } from '../../../core/social/social-message';

const MAX_CONTENT_LENGTH = 16_000;
const MAX_SEGMENTS = 200;

export interface OneBotQuote {
  id: string;
  text: string;
}

export interface OneBotNormalizeOptions {
  /** The account the bridge is logged in as; never answer ourselves. */
  selfId: string;
  now: number;
  /** Resolves a quoted message ID to one this character actually sent in that same target. */
  findQuote: (targetId: string, quotedId: string) => OneBotQuote | undefined;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** OneBot identifiers arrive as numbers or strings depending on the implementation. */
export const oneBotId = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && SOCIAL_ID_PATTERN.test(value)) return value;
  return undefined;
};

interface Extracted {
  text: string;
  mentionsSelf: boolean;
  quotedId?: string;
}

const CQ_CODE = /\[CQ:([a-z_]+)((?:,[^,\]]*)*)\]/giu;

const cqParam = (parameters: string, key: string): string | undefined => {
  for (const part of parameters.split(',')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator) === key) return part.slice(separator + 1);
  }
  return undefined;
};

/**
 * CQ-code form. Markup pointing at this character is consumed for the reply gate and removed;
 * markup naming anyone else stays literal text, so a user cannot forge a mention by typing one.
 */
const fromCqString = (raw: string, selfId: string): Extracted => {
  let mentionsSelf = false;
  let quotedId: string | undefined;
  const text = raw
    .replace(CQ_CODE, (marker, type: string, parameters: string) => {
      if (type === 'at') {
        const target = cqParam(parameters, 'qq');
        if (target === selfId || target === 'all') {
          mentionsSelf = true;
          return '';
        }
        return marker;
      }
      if (type === 'reply') {
        quotedId ??= cqParam(parameters, 'id');
        return '';
      }
      // Images, faces, records and the rest are dropped: only text reaches the character.
      return '';
    })
    .trim();
  return { text, mentionsSelf, ...(quotedId === undefined ? {} : { quotedId }) };
};

/** Segment-array form, which most implementations use when `message_format` is `array`. */
const fromSegments = (segments: unknown[], selfId: string): Extracted | undefined => {
  if (segments.length > MAX_SEGMENTS) return undefined;
  let text = '';
  let mentionsSelf = false;
  let quotedId: string | undefined;
  for (const entry of segments) {
    const segment = record(entry);
    if (!segment) continue;
    const data = record(segment.data) ?? {};
    if (segment.type === 'text') {
      if (typeof data.text === 'string') text += data.text;
      continue;
    }
    if (segment.type === 'at') {
      const target = data.qq;
      if (target === selfId || target === 'all' || oneBotId(target) === selfId) mentionsSelf = true;
      continue;
    }
    if (segment.type === 'reply') {
      quotedId ??= oneBotId(data.id);
    }
  }
  return { text: text.trim(), mentionsSelf, ...(quotedId === undefined ? {} : { quotedId }) };
};

/**
 * Narrows a OneBot v11 event into a `SocialMessage`. Private chats become `direct` targets and
 * groups become `group`; anything else (notices, requests, meta events) is ignored.
 */
export const normalizeOneBotMessage = (
  value: unknown,
  options: OneBotNormalizeOptions,
): SocialMessage | undefined => {
  const event = record(value);
  if (!event || event.post_type !== 'message') return undefined;
  const messageType = event.message_type;
  if (messageType !== 'private' && messageType !== 'group') return undefined;

  const userId = oneBotId(event.user_id);
  const messageId = oneBotId(event.message_id);
  const targetId = messageType === 'private' ? userId : oneBotId(event.group_id);
  if (!userId || !messageId || !targetId || userId === options.selfId) return undefined;

  const raw = event.message ?? event.raw_message;
  let extracted: Extracted | undefined;
  if (typeof raw === 'string') {
    if (raw.length > MAX_CONTENT_LENGTH) return undefined;
    extracted = fromCqString(raw, options.selfId);
  } else if (Array.isArray(raw)) {
    extracted = fromSegments(raw, options.selfId);
  }
  if (!extracted || extracted.text.length > MAX_CONTENT_LENGTH) return undefined;

  const quote = extracted.quotedId ? options.findQuote(targetId, extracted.quotedId) : undefined;
  const body = quote
    ? `[引用角色此前的回复]\n${quote.text.slice(0, 1_000)}\n[当前消息]\n${extracted.text.slice(0, 2_900)}`
    : extracted.text;
  if (!body) return undefined;

  const sender = record(event.sender) ?? {};
  const displayName = sender.card ?? sender.nickname;

  try {
    return parseSocialMessage({
      messageId,
      target: {
        platform: 'oopz',
        channelKind: messageType === 'private' ? 'direct' : 'group',
        channelId: targetId,
      },
      userId,
      ...(typeof displayName === 'string' && displayName ? { displayName } : {}),
      text: body,
      // A private chat is addressed to the character by construction.
      mentionsCharacter: messageType === 'private' || extracted.mentionsSelf,
      repliesToCharacter: quote !== undefined,
      ...(quote ? { replyToMessageId: quote.id } : {}),
      receivedAt: options.now,
    });
  } catch {
    return undefined;
  }
};
