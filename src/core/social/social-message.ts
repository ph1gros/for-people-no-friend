import {
  SOCIAL_ID_PATTERN,
  SOCIAL_MAX_AUDIO_BYTES,
  SOCIAL_MAX_AUDIO_DURATION_MS,
  SOCIAL_MAX_DISPLAY_NAME_LENGTH,
  SOCIAL_MAX_TEXT_LENGTH,
  isSocialChannelKind,
  isSocialPlatform,
  type SocialAudioPayload,
  type SocialMessage,
  type SocialTarget,
} from './social-contracts';

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/ogg',
  'audio/opus',
  'audio/silk',
  'audio/wav',
  'audio/x-wav',
]);

/** Keeps tab and newline, drops every other C0 control character plus DEL. */
const isControlCharacter = (codePoint: number): boolean =>
  codePoint < 0x20 ? codePoint !== 0x09 && codePoint !== 0x0a : codePoint === 0x7f;

const stripControlCharacters = (value: string): string => {
  let result = '';
  for (const character of value) {
    if (!isControlCharacter(character.codePointAt(0) ?? 0)) result += character;
  }
  return result;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalid = (): never => {
  throw new Error('The social message is invalid.');
};

const parseId = (value: unknown): string => {
  if (typeof value !== 'string' || !SOCIAL_ID_PATTERN.test(value)) invalid();
  return value as string;
};

const parseOptionalId = (value: unknown): string | undefined =>
  value === undefined ? undefined : parseId(value);

/**
 * Platform text is untrusted. Strip control characters, normalize line endings and clamp the
 * length before the value can reach the prompt, the history or a log line.
 */
export const sanitizeSocialText = (value: string): string =>
  stripControlCharacters(value.normalize('NFKC').replace(/\r\n?/gu, '\n'))
    .trim()
    .slice(0, SOCIAL_MAX_TEXT_LENGTH);

const parseOptionalText = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > SOCIAL_MAX_TEXT_LENGTH * 4) invalid();
  const sanitized = sanitizeSocialText(value as string);
  return sanitized.length > 0 ? sanitized : undefined;
};

const parseOptionalDisplayName = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') invalid();
  const sanitized = sanitizeSocialText(value as string).slice(0, SOCIAL_MAX_DISPLAY_NAME_LENGTH);
  return sanitized.length > 0 ? sanitized : undefined;
};

const parseTimestamp = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) invalid();
  return Math.trunc(value as number);
};

export const parseSocialTarget = (value: unknown): SocialTarget => {
  if (!isRecord(value)) invalid();
  const record = value as Record<string, unknown>;
  if (!isSocialPlatform(record.platform) || !isSocialChannelKind(record.channelKind)) invalid();
  const target: SocialTarget = {
    platform: record.platform as SocialTarget['platform'],
    channelKind: record.channelKind as SocialTarget['channelKind'],
    channelId: parseId(record.channelId),
  };
  const serverId = parseOptionalId(record.serverId);
  if (serverId !== undefined) target.serverId = serverId;
  return target;
};

const parseOptionalAudio = (value: unknown): SocialAudioPayload | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) invalid();
  const record = value as Record<string, unknown>;
  const data = record.data;
  if (
    typeof record.mimeType !== 'string' ||
    !ALLOWED_AUDIO_MIME_TYPES.has(record.mimeType) ||
    !(data instanceof Uint8Array) ||
    data.byteLength === 0 ||
    data.byteLength > SOCIAL_MAX_AUDIO_BYTES
  ) {
    invalid();
  }
  const audio: SocialAudioPayload = {
    mimeType: record.mimeType as string,
    data: data as Uint8Array,
  };
  if (record.durationMs !== undefined) {
    if (
      typeof record.durationMs !== 'number' ||
      !Number.isFinite(record.durationMs) ||
      record.durationMs <= 0 ||
      record.durationMs > SOCIAL_MAX_AUDIO_DURATION_MS
    ) {
      invalid();
    }
    audio.durationMs = Math.trunc(record.durationMs as number);
  }
  return audio;
};

/**
 * Narrows a raw adapter event into a `SocialMessage`. Adapters call this before handing a
 * message to the router so a malformed or hostile platform payload never reaches the core.
 */
export const parseSocialMessage = (value: unknown): SocialMessage => {
  if (!isRecord(value)) invalid();
  const record = value as Record<string, unknown>;
  if (typeof record.mentionsCharacter !== 'boolean') invalid();

  const message: SocialMessage = {
    messageId: parseId(record.messageId),
    target: parseSocialTarget(record.target),
    userId: parseId(record.userId),
    mentionsCharacter: record.mentionsCharacter as boolean,
    receivedAt: parseTimestamp(record.receivedAt),
  };

  const displayName = parseOptionalDisplayName(record.displayName);
  if (displayName !== undefined) message.displayName = displayName;
  const text = parseOptionalText(record.text);
  if (text !== undefined) message.text = text;
  const audio = parseOptionalAudio(record.audio);
  if (audio !== undefined) message.audio = audio;
  const replyToMessageId = parseOptionalId(record.replyToMessageId);
  if (replyToMessageId !== undefined) message.replyToMessageId = replyToMessageId;
  if (record.repliesToCharacter !== undefined) {
    if (typeof record.repliesToCharacter !== 'boolean') invalid();
    message.repliesToCharacter = record.repliesToCharacter as boolean;
  }

  if (message.text === undefined && message.audio === undefined) invalid();
  return message;
};
