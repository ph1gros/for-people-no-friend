import { describe, expect, it } from 'vitest';

import type { SocialTarget } from '../src/core/social/social-contracts';
import { SocialActorDirectory } from '../src/core/social/social-identity';
import {
  canUseSocialMemory,
  inferDefaultSocialMemoryScope,
  isDurableSocialMemoryScope,
  resolveSocialChannelToken,
  resolveSocialMemoryNamespace,
  selectUsableSocialMemories,
  type SocialMemoryAudience,
} from '../src/core/social/social-memory-scope';
import { createSocialMessage, fakeHashId } from './helpers/fake-social-adapter';

const CHARACTER_NAMESPACE = 'character-abc123';

const directory = new SocialActorDirectory(fakeHashId, [
  { platform: 'qq', userId: 'owner-account', actorClass: 'owner' },
]);

const ownerActor = directory.resolve(createSocialMessage({ userId: 'owner-account' }));
const guestActor = directory.resolve(createSocialMessage({ userId: 'guest-account' }));

const directTarget: SocialTarget = { platform: 'qq', channelKind: 'direct', channelId: 'dm-1' };
const groupTarget: SocialTarget = { platform: 'qq', channelKind: 'group', channelId: 'group-1' };
const groupToken = resolveSocialChannelToken(fakeHashId, groupTarget);

const audience = (overrides: Partial<SocialMemoryAudience> = {}): SocialMemoryAudience => ({
  actorId: ownerActor.actorId,
  actorClass: 'owner',
  platform: 'qq',
  channelKind: 'direct',
  channelToken: resolveSocialChannelToken(fakeHashId, directTarget),
  ...overrides,
});

describe('social memory scope', () => {
  it('keeps owner direct messages in the shared character namespace for continuity', () => {
    expect(inferDefaultSocialMemoryScope(ownerActor, directTarget)).toBe('private');
    expect(
      resolveSocialMemoryNamespace(CHARACTER_NAMESPACE, {
        scope: 'private',
        actorId: ownerActor.actorId,
        platform: 'qq',
      }),
    ).toBe(CHARACTER_NAMESPACE);
  });

  it('isolates every other conversation into its own namespace', () => {
    expect(inferDefaultSocialMemoryScope(guestActor, directTarget)).toBe('personal');
    expect(inferDefaultSocialMemoryScope(guestActor, groupTarget)).toBe('channel');
    expect(inferDefaultSocialMemoryScope(ownerActor, groupTarget)).toBe('channel');

    const personal = resolveSocialMemoryNamespace(CHARACTER_NAMESPACE, {
      scope: 'personal',
      actorId: guestActor.actorId,
      platform: 'qq',
    });
    const channel = resolveSocialMemoryNamespace(CHARACTER_NAMESPACE, {
      scope: 'channel',
      actorId: guestActor.actorId,
      platform: 'qq',
      channelToken: groupToken,
    });

    expect(personal).toBe(`${CHARACTER_NAMESPACE}/actor/${guestActor.actorId}`);
    expect(channel).toBe(`${CHARACTER_NAMESPACE}/channel/qq/${groupToken}`);
    expect(new Set([CHARACTER_NAMESPACE, personal, channel]).size).toBe(3);
  });

  it('refuses to build a namespace without the data it needs', () => {
    expect(() =>
      resolveSocialMemoryNamespace('  ', { scope: 'private', actorId: 'a', platform: 'qq' }),
    ).toThrow();
    expect(() =>
      resolveSocialMemoryNamespace(CHARACTER_NAMESPACE, {
        scope: 'channel',
        actorId: 'a',
        platform: 'qq',
      }),
    ).toThrow();
    expect(() =>
      resolveSocialMemoryNamespace(CHARACTER_NAMESPACE, {
        scope: 'ephemeral',
        actorId: 'a',
        platform: 'qq',
      }),
    ).toThrow();
    expect(isDurableSocialMemoryScope('ephemeral')).toBe(false);
    expect(isDurableSocialMemoryScope('channel')).toBe(true);
  });

  it('never leaks what one person said to another person', () => {
    const origin = { scope: 'personal', actorId: guestActor.actorId, platform: 'qq' } as const;

    expect(
      canUseSocialMemory(origin, audience({ actorId: guestActor.actorId, actorClass: 'guest' })),
    ).toBe(true);
    expect(canUseSocialMemory(origin, audience({ actorId: ownerActor.actorId }))).toBe(false);
    expect(
      canUseSocialMemory(
        origin,
        audience({ actorId: guestActor.actorId, actorClass: 'guest', channelKind: 'group' }),
      ),
    ).toBe(false);
  });

  it('withholds private memories in any room that has bystanders', () => {
    const origin = { scope: 'private', actorId: ownerActor.actorId, platform: 'qq' } as const;

    expect(canUseSocialMemory(origin, audience())).toBe(true);
    expect(canUseSocialMemory(origin, audience({ channelKind: 'group' }))).toBe(false);
    expect(canUseSocialMemory(origin, audience({ actorClass: 'guest' }))).toBe(false);
  });

  it('binds channel memories to their own channel and platform', () => {
    const origin = {
      scope: 'channel',
      actorId: guestActor.actorId,
      platform: 'qq',
      channelToken: groupToken,
    } as const;

    expect(
      canUseSocialMemory(origin, audience({ channelKind: 'group', channelToken: groupToken })),
    ).toBe(true);
    expect(
      canUseSocialMemory(
        origin,
        audience({
          channelKind: 'group',
          channelToken: resolveSocialChannelToken(fakeHashId, {
            platform: 'qq',
            channelKind: 'group',
            channelId: 'group-2',
          }),
        }),
      ),
    ).toBe(false);
    expect(
      canUseSocialMemory(
        origin,
        audience({ platform: 'kook', channelKind: 'group', channelToken: groupToken }),
      ),
    ).toBe(false);
  });

  it('treats shared memories as usable and ephemeral memories as never recallable', () => {
    expect(
      canUseSocialMemory(
        { scope: 'shared', actorId: guestActor.actorId, platform: 'qq' },
        audience({ channelKind: 'group', actorClass: 'unknown' }),
      ),
    ).toBe(true);
    expect(
      canUseSocialMemory(
        { scope: 'ephemeral', actorId: ownerActor.actorId, platform: 'qq' },
        audience(),
      ),
    ).toBe(false);
  });

  it('filters a record set down to what the current audience may hear', () => {
    const records = [
      { id: 'a', origin: { scope: 'private', actorId: ownerActor.actorId, platform: 'qq' } },
      { id: 'b', origin: { scope: 'personal', actorId: guestActor.actorId, platform: 'qq' } },
      { id: 'c', origin: { scope: 'shared', actorId: guestActor.actorId, platform: 'qq' } },
    ] as const;

    expect(selectUsableSocialMemories([...records], audience()).map(({ id }) => id)).toEqual([
      'a',
      'c',
    ]);
  });

  it('separates channels that only differ by server', () => {
    const withoutServer = resolveSocialChannelToken(fakeHashId, groupTarget);
    const withServer = resolveSocialChannelToken(fakeHashId, { ...groupTarget, serverId: 's-1' });

    expect(withoutServer).not.toBe(withServer);
  });
});
