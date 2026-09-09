import { SOCIAL_ID_PATTERN, type SocialMessage } from '../../../core/social/social-contracts';
import { parseSocialMessage } from '../../../core/social/social-message';

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
export const qqId = (value: unknown): string | undefined =>
  typeof value === 'string' && SOCIAL_ID_PATTERN.test(value) ? value : undefined;

export interface QqQuote {
  id: string;
  text: string;
}

const MAX_ATTACHMENTS = 20;
const MAX_TRANSCRIPT_LENGTH = 16_000;

/**
 * QQ runs its own speech recognition and pushes the transcript alongside the voice attachment.
 * Using it lets the character answer voice notes without downloading media from a CDN, so no new
 * outbound network surface is introduced. The raw audio URL is deliberately ignored.
 *
 * The transcript is user speech: untrusted input, narrowed and bounded like any message text.
 */
const voiceTranscript = (value: unknown): string | undefined => {
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) return undefined;
  for (const entry of value) {
    const attachment = record(entry);
    if (!attachment) continue;
    const contentType = attachment.content_type;
    const isVoice =
      contentType === 'voice' ||
      (typeof contentType === 'string' && contentType.startsWith('audio/'));
    if (!isVoice) continue;
    const transcript = attachment.asr_refer_text;
    if (
      typeof transcript === 'string' &&
      transcript.length <= MAX_TRANSCRIPT_LENGTH &&
      transcript.trim()
    ) {
      return transcript.trim();
    }
  }
  return undefined;
};

/** SDK data is still untrusted. No attachment URL, native account payload or SDK object escapes. */
export const normalizeQqMessage = (
  value: unknown,
  options: {
    appId: string;
    selfUserId: string;
    now: number;
    findQuote: (kind: 'c2c' | 'group', targetId: string, reference: string) => QqQuote | undefined;
  },
): SocialMessage | undefined => {
  const event = record(value);
  if (!event || (event.kind !== 'c2c' && event.kind !== 'group')) return undefined;
  if (event.kind === 'c2c' && event.rawEventType !== 'C2C_MESSAGE_CREATE') return undefined;
  if (
    event.kind === 'group' &&
    event.rawEventType !== 'GROUP_AT_MESSAGE_CREATE' &&
    event.rawEventType !== 'GROUP_MESSAGE_CREATE'
  )
    return undefined;
  const userId = qqId(event.senderId);
  const messageId = qqId(event.messageId);
  const targetId = event.kind === 'c2c' ? userId : qqId(event.groupOpenid);
  if (
    !userId ||
    !messageId ||
    !targetId ||
    userId === options.selfUserId ||
    event.senderIsBot === true ||
    typeof event.content !== 'string' ||
    event.content.length > 16_000
  ) {
    return undefined;
  }
  const mentionsCharacter =
    event.rawEventType === 'GROUP_AT_MESSAGE_CREATE' ||
    (Array.isArray(event.mentions) &&
      event.mentions.length <= 100 &&
      event.mentions.some((mention) => record(mention)?.is_you === true));
  // Never derive the reply gate from user-typed mention markup.
  const text = event.content
    .replace(/<@!?([A-Za-z0-9_:.-]+)>/gu, (marker, id: string) =>
      id === options.selfUserId || id === options.appId ? '' : marker,
    )
    .trim();
  // A voice note carries no text content; the platform transcript stands in for it.
  const spoken = text ? undefined : voiceTranscript(event.attachments);
  const body = spoken ? `[语音消息]\n${spoken}` : text;
  if (!body) return undefined;
  const rawReference = record(record(event.raw)?.message_reference);
  const reference = qqId(event.refMsgIdx) ?? qqId(rawReference?.message_id);
  const quote = reference ? options.findQuote(event.kind, targetId, reference) : undefined;
  try {
    return parseSocialMessage({
      messageId,
      target: {
        platform: 'qq',
        channelKind: event.kind === 'c2c' ? 'direct' : 'group',
        channelId: targetId,
      },
      userId,
      ...(typeof event.senderName === 'string' ? { displayName: event.senderName } : {}),
      text: quote
        ? `[引用角色此前的回复]\n${quote.text.slice(0, 1_000)}\n[当前消息]\n${body.slice(0, 2_900)}`
        : body,
      mentionsCharacter,
      repliesToCharacter: !!quote,
      ...(quote ? { replyToMessageId: quote.id } : {}),
      receivedAt: options.now,
    });
  } catch {
    return undefined;
  }
};
