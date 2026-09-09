export const SOCIAL_PLATFORMS = ['qq', 'kook', 'oopz'] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_CHANNEL_KINDS = ['direct', 'group', 'channel'] as const;

/**
 * `direct` is a one-to-one conversation, `group` is an unstructured multi-user room, and
 * `channel` is a channel inside a server or guild. Voice rooms are modelled as a capability
 * of an existing target rather than as a separate channel kind.
 */
export type SocialChannelKind = (typeof SOCIAL_CHANNEL_KINDS)[number];

export const SOCIAL_CONNECTION_STATES = [
  'not-configured',
  'offline',
  'connecting',
  'online',
  'error',
] as const;

export type SocialConnectionState = (typeof SOCIAL_CONNECTION_STATES)[number];

export const SOCIAL_MAX_ID_LENGTH = 128;
export const SOCIAL_MAX_DISPLAY_NAME_LENGTH = 64;
export const SOCIAL_MAX_TEXT_LENGTH = 4_000;
export const SOCIAL_MAX_AUDIO_BYTES = 8 * 1_048_576;
export const SOCIAL_MAX_AUDIO_DURATION_MS = 600_000;

export const SOCIAL_ID_PATTERN = /^[A-Za-z0-9_:.-]{1,128}$/;

export interface SocialTarget {
  platform: SocialPlatform;
  channelKind: SocialChannelKind;
  channelId: string;
  serverId?: string;
}

export interface SocialAudioPayload {
  mimeType: string;
  data: Uint8Array;
  durationMs?: number;
}

/**
 * A platform-neutral inbound message. Adapters normalize native QQ / KOOK / Oopz events into
 * this shape so the conversation core never sees a platform-specific payload.
 */
export interface SocialMessage {
  messageId: string;
  target: SocialTarget;
  userId: string;
  displayName?: string;
  text?: string;
  audio?: SocialAudioPayload;
  replyToMessageId?: string;
  /** True only when the adapter verified the quote belongs to this character in this target. */
  repliesToCharacter?: boolean;
  mentionsCharacter: boolean;
  receivedAt: number;
}

export interface SocialAdapterCapabilities {
  /** Every adapter must support text. The remaining capabilities stay optional by design. */
  readonly text: true;
  /** Can post a native voice message into a conversation. */
  readonly audioMessage: boolean;
  /** Can join and stay in a voice room. Speaking there is a separate, later capability. */
  readonly voiceChannel: boolean;
  readonly streamingText: boolean;
}

export interface SocialVoiceSession {
  readonly target: SocialTarget;
  /** Explicit output only: bounded PCM16 WAV, never microphone capture. */
  play?(wav: Uint8Array, signal: AbortSignal): Promise<void>;
  leave(): Promise<void>;
}

export type SocialMessageHandler = (message: SocialMessage) => void;

export interface SocialSendContext {
  /** The exact inbound trigger, not the last message observed in this target. */
  replyToMessageId: string;
  signal: AbortSignal;
}

/**
 * Hashes a raw platform identifier into an opaque, stable token. The core layer stays free of
 * Node APIs, so the concrete digest is supplied by the host process.
 */
export type SocialIdHasher = (platform: SocialPlatform, value: string) => string;

export const SOCIAL_ID_TOKEN_PATTERN = /^[a-f0-9]{8,64}$/;

export interface SocialPlatformAdapter {
  readonly platform: SocialPlatform;
  readonly capabilities: SocialAdapterCapabilities;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Returns an unsubscribe function so the router can detach without disconnecting. */
  onMessage(handler: SocialMessageHandler): () => void;
  /** Optional transport lifecycle updates after the initial connection (e.g. reconnect). */
  onStateChange?(handler: (state: SocialConnectionState) => void): () => void;
  sendText(target: SocialTarget, text: string, context?: SocialSendContext): Promise<void>;
  /** Present only when the adapter declares `audioMessage`. Same authorization as `sendText`. */
  sendAudio?(
    target: SocialTarget,
    audio: SocialAudioPayload,
    context?: SocialSendContext,
  ): Promise<void>;
  joinVoice?(target: SocialTarget): Promise<SocialVoiceSession>;
}

export interface SocialPresenceEntry {
  platform: SocialPlatform;
  state: SocialConnectionState;
  capabilities: SocialAdapterCapabilities;
  /** Present only for `error`; already redacted by the registry before it is stored. */
  errorMessage?: string;
  updatedAt: number;
}

export const isSocialPlatform = (value: unknown): value is SocialPlatform =>
  typeof value === 'string' && (SOCIAL_PLATFORMS as readonly string[]).includes(value);

export const isSocialChannelKind = (value: unknown): value is SocialChannelKind =>
  typeof value === 'string' && (SOCIAL_CHANNEL_KINDS as readonly string[]).includes(value);

export const describeSocialTarget = (target: SocialTarget): string =>
  `${target.platform}:${target.channelKind}:${target.serverId ?? '-'}:${target.channelId}`;
