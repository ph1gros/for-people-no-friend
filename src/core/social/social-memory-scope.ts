import {
  SOCIAL_ID_TOKEN_PATTERN,
  type SocialChannelKind,
  type SocialIdHasher,
  type SocialPlatform,
  type SocialTarget,
} from './social-contracts';
import type { SocialActor, SocialActorClass } from './social-identity';

export const SOCIAL_MEMORY_SCOPES = [
  'private',
  'personal',
  'shared',
  'channel',
  'ephemeral',
] as const;

/**
 * Visibility of a memory produced on a social surface.
 *
 * - `private`   Owner and character only.
 * - `personal`  May be recalled when talking to the same person again.
 * - `shared`    Explicitly marked as safe to use in a group conversation.
 * - `channel`   Belongs to one server or channel only.
 * - `ephemeral` Conversation context only; never persisted.
 */
export type SocialMemoryScope = (typeof SOCIAL_MEMORY_SCOPES)[number];

export interface SocialMemoryOrigin {
  scope: SocialMemoryScope;
  actorId: string;
  platform: SocialPlatform;
  /** Required for `channel`; ignored otherwise. */
  channelToken?: string;
}

export interface SocialMemoryAudience {
  actorId: string;
  actorClass: SocialActorClass;
  platform: SocialPlatform;
  channelKind: SocialChannelKind;
  channelToken: string;
}

export const isDurableSocialMemoryScope = (scope: SocialMemoryScope): boolean =>
  scope !== 'ephemeral';

export const resolveSocialChannelToken = (hash: SocialIdHasher, target: SocialTarget): string => {
  const token = hash(target.platform, `${target.serverId ?? ''}\u0000${target.channelId}`);
  if (typeof token !== 'string' || !SOCIAL_ID_TOKEN_PATTERN.test(token)) {
    throw new Error('The social identity hasher returned an invalid token.');
  }
  return token;
};

export const describeSocialMemoryAudience = (
  actor: SocialActor,
  target: SocialTarget,
  channelToken: string,
): SocialMemoryAudience => ({
  actorId: actor.actorId,
  actorClass: actor.actorClass,
  platform: target.platform,
  channelKind: target.channelKind,
  channelToken,
});

/**
 * The conservative default from the safety model: an owner speaking privately keeps writing into
 * the character's own pool, anybody else gets an isolated per-actor or per-channel pool.
 */
export const inferDefaultSocialMemoryScope = (
  actor: SocialActor,
  target: SocialTarget,
): SocialMemoryScope => {
  if (target.channelKind !== 'direct') return 'channel';
  return actor.actorClass === 'owner' ? 'private' : 'personal';
};

/**
 * Namespace a social memory is stored under. `private` deliberately reuses the character's own
 * desktop namespace so the owner keeps one continuous relationship across surfaces; every other
 * scope is isolated so one user's statement can never surface in another user's conversation.
 */
export const resolveSocialMemoryNamespace = (
  characterNamespace: string,
  origin: SocialMemoryOrigin,
): string => {
  if (!characterNamespace.trim()) {
    throw new Error('The character memory namespace is required.');
  }
  switch (origin.scope) {
    case 'private':
      return characterNamespace;
    case 'personal':
      return `${characterNamespace}/actor/${origin.actorId}`;
    case 'shared':
      return `${characterNamespace}/shared`;
    case 'channel': {
      if (!origin.channelToken) {
        throw new Error('A channel-scoped social memory requires a channel token.');
      }
      return `${characterNamespace}/channel/${origin.platform}/${origin.channelToken}`;
    }
    case 'ephemeral':
      throw new Error('An ephemeral social memory is never persisted.');
  }
};

/**
 * Guards recall. A memory is only offered to the conversation core when its origin scope allows
 * the current audience to hear it. Anything unproven stays hidden.
 */
export const canUseSocialMemory = (
  origin: SocialMemoryOrigin,
  audience: SocialMemoryAudience,
): boolean => {
  switch (origin.scope) {
    case 'ephemeral':
      return false;
    case 'private':
      // Even the owner does not get private recall in a room that has bystanders.
      return audience.actorClass === 'owner' && audience.channelKind === 'direct';
    case 'personal':
      return origin.actorId === audience.actorId && audience.channelKind === 'direct';
    case 'shared':
      return true;
    case 'channel':
      return origin.platform === audience.platform && origin.channelToken === audience.channelToken;
  }
};

export const selectUsableSocialMemories = <T extends { origin: SocialMemoryOrigin }>(
  records: readonly T[],
  audience: SocialMemoryAudience,
): T[] => records.filter((record) => canUseSocialMemory(record.origin, audience));
