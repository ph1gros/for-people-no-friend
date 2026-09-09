import {
  SOCIAL_ID_PATTERN,
  SOCIAL_PLATFORMS,
  isSocialPlatform,
  type SocialPlatform,
} from './social-contracts';
import { validateSocialActorBinding, type SocialActorBinding } from './social-identity';
import { DEFAULT_SOCIAL_REPLY_POLICY, type SocialReplyPolicy } from './social-reply-policy';

/**
 * Credential slots per platform. Values live in the encrypted secret store; only these IDs and
 * the non-secret account identifiers are ever written to ordinary configuration.
 */
export const SOCIAL_CREDENTIAL_KEYS = {
  qq: ['app-secret'],
  kook: ['bot-token'],
  oopz: ['password'],
} as const satisfies Record<SocialPlatform, readonly string[]>;

export type SocialCredentialKey<P extends SocialPlatform = SocialPlatform> =
  (typeof SOCIAL_CREDENTIAL_KEYS)[P][number];

/** Matches the secret store's `^[a-z0-9][a-z0-9-]{0,63}$` identifier rule. */
export const socialSecretId = <P extends SocialPlatform>(
  platform: P,
  key: SocialCredentialKey<P>,
): string => `social-${platform}-${key}`;

export const MAX_SOCIAL_OWNER_ACCOUNTS = 8;
export const MAX_SOCIAL_ACTOR_BINDINGS = 256;
export const MAX_SOCIAL_BLOCKED_ACTORS = 256;
const MAX_ACCOUNT_ID_LENGTH = 128;

export interface SocialAccountConfig {
  platform: SocialPlatform;
  enabled: boolean;
  /** Non-secret platform identifier, such as a QQ App ID. */
  accountId?: string;
  /** Raw platform user IDs of the owner's own accounts on that platform. */
  ownerUserIds: string[];
  replyPolicy: SocialReplyPolicy;
  /**
   * Reply with a native voice message instead of text. Off by default and only honoured when the
   * optional SILK codec is present, so voice output stays an explicit opt-in.
   */
  voiceReplyEnabled: boolean;
}

export interface SocialPresenceConfig {
  version: 1;
  /** Bound to one character, never to the whole application. */
  characterId: string;
  accounts: SocialAccountConfig[];
  bindings: SocialActorBinding[];
}

export const createDefaultSocialAccountConfig = (
  platform: SocialPlatform,
): SocialAccountConfig => ({
  platform,
  enabled: false,
  ownerUserIds: [],
  replyPolicy: { ...DEFAULT_SOCIAL_REPLY_POLICY, blockedActorIds: [] },
  voiceReplyEnabled: false,
});

export const createDefaultSocialPresenceConfig = (characterId: string): SocialPresenceConfig => ({
  version: 1,
  characterId,
  accounts: SOCIAL_PLATFORMS.map(createDefaultSocialAccountConfig),
  bindings: [],
});

const invalid = (): never => {
  throw new Error('The social presence configuration is invalid.');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseIdList = (value: unknown, maximum: number): string[] => {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  const list = value as unknown[];
  const parsed = list.map((entry) => {
    if (typeof entry !== 'string' || !SOCIAL_ID_PATTERN.test(entry)) invalid();
    return entry as string;
  });
  return [...new Set(parsed)];
};

const parseReplyPolicy = (value: unknown): SocialReplyPolicy => {
  if (!isRecord(value)) invalid();
  const record = value as Record<string, unknown>;
  if (
    typeof record.respondInDirectMessages !== 'boolean' ||
    typeof record.requireMentionInGroups !== 'boolean' ||
    typeof record.respondToUnknownActors !== 'boolean'
  ) {
    invalid();
  }
  return {
    respondInDirectMessages: record.respondInDirectMessages as boolean,
    requireMentionInGroups: record.requireMentionInGroups as boolean,
    respondToUnknownActors: record.respondToUnknownActors as boolean,
    blockedActorIds: parseIdList(record.blockedActorIds ?? [], MAX_SOCIAL_BLOCKED_ACTORS),
  };
};

export const parseSocialAccountConfig = (value: unknown): SocialAccountConfig => {
  if (!isRecord(value)) invalid();
  const record = value as Record<string, unknown>;
  if (!isSocialPlatform(record.platform) || typeof record.enabled !== 'boolean') invalid();
  const account: SocialAccountConfig = {
    platform: record.platform as SocialPlatform,
    enabled: record.enabled as boolean,
    ownerUserIds: parseIdList(record.ownerUserIds ?? [], MAX_SOCIAL_OWNER_ACCOUNTS),
    replyPolicy: parseReplyPolicy(record.replyPolicy ?? DEFAULT_SOCIAL_REPLY_POLICY),
    // Absent in configurations written before voice replies existed: those stay off.
    voiceReplyEnabled: record.voiceReplyEnabled === true,
  };
  if (record.accountId !== undefined) {
    if (
      typeof record.accountId !== 'string' ||
      record.accountId.trim().length === 0 ||
      record.accountId.length > MAX_ACCOUNT_ID_LENGTH ||
      !SOCIAL_ID_PATTERN.test(record.accountId.trim())
    ) {
      invalid();
    }
    account.accountId = (record.accountId as string).trim();
  }
  return account;
};

export const parseSocialPresenceConfig = (value: unknown): SocialPresenceConfig => {
  if (!isRecord(value)) invalid();
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.characterId !== 'string' ||
    !SOCIAL_ID_PATTERN.test(record.characterId) ||
    !Array.isArray(record.accounts) ||
    record.accounts.length > SOCIAL_PLATFORMS.length ||
    !Array.isArray(record.bindings) ||
    record.bindings.length > MAX_SOCIAL_ACTOR_BINDINGS
  ) {
    invalid();
  }
  const accounts = (record.accounts as unknown[]).map(parseSocialAccountConfig);
  if (new Set(accounts.map(({ platform }) => platform)).size !== accounts.length) invalid();
  const bindings = (record.bindings as unknown[]).map(validateSocialActorBinding);
  if (
    new Set(bindings.map(({ platform, userId }) => `${platform}\u0000${userId}`)).size !==
    bindings.length
  ) {
    invalid();
  }
  return { version: 1, characterId: record.characterId as string, accounts, bindings };
};
