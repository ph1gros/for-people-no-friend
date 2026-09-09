import type { SocialMessage } from './social-contracts';
import type { SocialActor } from './social-identity';

export const SOCIAL_IGNORE_REASONS = [
  'self-message',
  'blocked-actor',
  'empty-content',
  'direct-messages-disabled',
  'mention-required',
  'unknown-actor-blocked',
] as const;

export type SocialIgnoreReason = (typeof SOCIAL_IGNORE_REASONS)[number];

export type SocialReplyDecision =
  { action: 'answer' } | { action: 'ignore'; reason: SocialIgnoreReason };

export interface SocialReplyPolicy {
  /** Reply to one-to-one conversations without requiring a mention. */
  respondInDirectMessages: boolean;
  /** In a group or channel, only reply when mentioned or replied to. */
  requireMentionInGroups: boolean;
  /** Allow actors the user has never bound to answer at all. */
  respondToUnknownActors: boolean;
  blockedActorIds: readonly string[];
}

/**
 * Hard admission gate. The shared Turn Manager subsequently schedules eligible messages,
 * enforces cooldowns/rate limits, and optionally handles owner priority/interruption.
 */
export const DEFAULT_SOCIAL_REPLY_POLICY: SocialReplyPolicy = {
  respondInDirectMessages: true,
  requireMentionInGroups: true,
  respondToUnknownActors: true,
  blockedActorIds: [],
};

export interface SocialReplyInput {
  message: SocialMessage;
  actor: SocialActor;
  /** The character's own account ID on that platform, used to break reply loops. */
  selfUserId?: string;
  policy?: SocialReplyPolicy;
}

export const decideSocialReply = ({
  message,
  actor,
  selfUserId,
  policy = DEFAULT_SOCIAL_REPLY_POLICY,
}: SocialReplyInput): SocialReplyDecision => {
  if (selfUserId !== undefined && message.userId === selfUserId) {
    return { action: 'ignore', reason: 'self-message' };
  }
  if (policy.blockedActorIds.includes(actor.actorId)) {
    return { action: 'ignore', reason: 'blocked-actor' };
  }
  if (message.text === undefined && message.audio === undefined) {
    return { action: 'ignore', reason: 'empty-content' };
  }
  if (!policy.respondToUnknownActors && actor.actorClass === 'unknown') {
    return { action: 'ignore', reason: 'unknown-actor-blocked' };
  }
  if (message.target.channelKind === 'direct') {
    return policy.respondInDirectMessages
      ? { action: 'answer' }
      : { action: 'ignore', reason: 'direct-messages-disabled' };
  }
  if (policy.requireMentionInGroups && !message.mentionsCharacter && !message.repliesToCharacter) {
    return { action: 'ignore', reason: 'mention-required' };
  }
  return { action: 'answer' };
};
