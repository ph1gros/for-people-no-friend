import { describe, expect, it } from 'vitest';

import { SocialActorDirectory } from '../src/core/social/social-identity';
import {
  DEFAULT_SOCIAL_REPLY_POLICY,
  decideSocialReply,
} from '../src/core/social/social-reply-policy';
import { createSocialMessage, fakeHashId } from './helpers/fake-social-adapter';

const directory = new SocialActorDirectory(fakeHashId, [
  { platform: 'qq', userId: 'owner-account', actorClass: 'owner' },
]);

const decide = (
  message = createSocialMessage(),
  policy = DEFAULT_SOCIAL_REPLY_POLICY,
  selfUserId?: string,
) =>
  decideSocialReply({
    message,
    actor: directory.resolve(message),
    policy,
    ...(selfUserId !== undefined ? { selfUserId } : {}),
  });

describe('default social reply gate', () => {
  it('answers direct messages', () => {
    expect(decide()).toEqual({ action: 'answer' });
  });

  it('stays silent in a group until it is addressed', () => {
    const grouped = createSocialMessage({
      target: { platform: 'qq', channelKind: 'group', channelId: 'g1' },
    });
    expect(decide(grouped)).toEqual({ action: 'ignore', reason: 'mention-required' });

    expect(decide({ ...grouped, mentionsCharacter: true })).toEqual({ action: 'answer' });
    expect(decide({ ...grouped, replyToMessageId: 'previous' })).toEqual({
      action: 'ignore',
      reason: 'mention-required',
    });
    expect(decide({ ...grouped, replyToMessageId: 'previous', repliesToCharacter: true })).toEqual({
      action: 'answer',
    });
  });

  it('breaks reply loops caused by messages the character itself sent', () => {
    const own = createSocialMessage({ userId: 'bot-account' });
    expect(decide(own, DEFAULT_SOCIAL_REPLY_POLICY, 'bot-account')).toEqual({
      action: 'ignore',
      reason: 'self-message',
    });
  });

  it('honours blocked actors ahead of everything else', () => {
    const message = createSocialMessage({ userId: 'spammer' });
    const actor = directory.resolve(message);
    expect(
      decideSocialReply({
        message,
        actor,
        policy: { ...DEFAULT_SOCIAL_REPLY_POLICY, blockedActorIds: [actor.actorId] },
      }),
    ).toEqual({ action: 'ignore', reason: 'blocked-actor' });
  });

  it('can be narrowed to disable direct messages or unknown accounts', () => {
    expect(
      decide(createSocialMessage(), {
        ...DEFAULT_SOCIAL_REPLY_POLICY,
        respondInDirectMessages: false,
      }),
    ).toEqual({ action: 'ignore', reason: 'direct-messages-disabled' });

    const grouped = createSocialMessage({
      mentionsCharacter: true,
      target: { platform: 'qq', channelKind: 'group', channelId: 'g1' },
    });
    expect(
      decide(grouped, { ...DEFAULT_SOCIAL_REPLY_POLICY, respondToUnknownActors: false }),
    ).toEqual({ action: 'ignore', reason: 'unknown-actor-blocked' });
  });

  it('can be widened so a group conversation no longer needs a mention', () => {
    const grouped = createSocialMessage({
      target: { platform: 'qq', channelKind: 'group', channelId: 'g1' },
    });
    expect(
      decide(grouped, { ...DEFAULT_SOCIAL_REPLY_POLICY, requireMentionInGroups: false }),
    ).toEqual({ action: 'answer' });
  });

  it('ignores a message that carries neither text nor audio', () => {
    const empty = { ...createSocialMessage(), text: undefined };
    expect(decide(empty)).toEqual({ action: 'ignore', reason: 'empty-content' });
  });

  it('defaults to the conservative policy', () => {
    expect(DEFAULT_SOCIAL_REPLY_POLICY).toEqual({
      respondInDirectMessages: true,
      requireMentionInGroups: true,
      respondToUnknownActors: true,
      blockedActorIds: [],
    });
  });
});
