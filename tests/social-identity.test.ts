import { describe, expect, it } from 'vitest';

import {
  SocialActorDirectory,
  validateSocialActorBinding,
} from '../src/core/social/social-identity';
import { createSocialMessage, fakeHashId } from './helpers/fake-social-adapter';

describe('social actor directory', () => {
  it('classifies a bound owner, a bound acquaintance and unbound accounts', () => {
    const directory = new SocialActorDirectory(fakeHashId, [
      { platform: 'qq', userId: 'owner-account', actorClass: 'owner', label: 'me' },
      { platform: 'qq', userId: 'friend-account', actorClass: 'known-user' },
    ]);

    expect(directory.resolve(createSocialMessage({ userId: 'owner-account' })).actorClass).toBe(
      'owner',
    );
    expect(directory.resolve(createSocialMessage({ userId: 'friend-account' })).actorClass).toBe(
      'known-user',
    );
    expect(directory.resolve(createSocialMessage({ userId: 'stranger' })).actorClass).toBe('guest');
    expect(
      directory.resolve(
        createSocialMessage({
          userId: 'stranger',
          target: { platform: 'qq', channelKind: 'group', channelId: 'g1' },
        }),
      ).actorClass,
    ).toBe('unknown');
  });

  it('keeps a binding scoped to one platform', () => {
    const directory = new SocialActorDirectory(fakeHashId, [
      { platform: 'qq', userId: 'shared-id', actorClass: 'owner' },
    ]);

    expect(directory.resolve(createSocialMessage({ userId: 'shared-id' })).actorClass).toBe(
      'owner',
    );
    expect(
      directory.resolve(
        createSocialMessage({
          userId: 'shared-id',
          target: { platform: 'kook', channelKind: 'direct', channelId: 'dm' },
        }),
      ).actorClass,
    ).toBe('guest');
  });

  it('produces stable de-identified actor IDs that never contain the raw account ID', () => {
    const directory = new SocialActorDirectory(fakeHashId);
    const first = directory.resolve(createSocialMessage({ userId: 'sensitive-account' }));
    const second = directory.resolve(createSocialMessage({ userId: 'sensitive-account' }));
    const other = directory.resolve(createSocialMessage({ userId: 'another-account' }));

    expect(first.actorId).toBe(second.actorId);
    expect(first.actorId).not.toBe(other.actorId);
    expect(first.actorId.startsWith('qq-')).toBe(true);
    expect(first.actorId).not.toContain('sensitive-account');
  });

  it('rejects a hasher that returns an unusable token', () => {
    const directory = new SocialActorDirectory(() => 'NOT-A-TOKEN');
    expect(() => directory.resolve(createSocialMessage())).toThrow(
      'The social identity hasher returned an invalid token.',
    );
  });

  it('supports binding, unbinding and snapshotting', () => {
    const directory = new SocialActorDirectory(fakeHashId);
    directory.bind({ platform: 'kook', userId: 'k-1', actorClass: 'known-user', label: '  Ann  ' });

    expect(directory.snapshot()).toEqual([
      { platform: 'kook', userId: 'k-1', actorClass: 'known-user', label: 'Ann' },
    ]);
    expect(directory.unbind('kook', 'k-1')).toBe(true);
    expect(directory.unbind('kook', 'k-1')).toBe(false);
    expect(directory.snapshot()).toEqual([]);
  });

  it('validates bindings before they enter the directory', () => {
    expect(() =>
      validateSocialActorBinding({ platform: 'qq', userId: 'a', actorClass: 'guest' }),
    ).toThrow();
    expect(() =>
      validateSocialActorBinding({ platform: 'wechat', userId: 'a', actorClass: 'owner' }),
    ).toThrow();
    expect(() =>
      validateSocialActorBinding({ platform: 'qq', userId: 'a b', actorClass: 'owner' }),
    ).toThrow();
    expect(() =>
      validateSocialActorBinding({
        platform: 'qq',
        userId: 'a',
        actorClass: 'owner',
        label: 'x'.repeat(200),
      }),
    ).toThrow();
  });
});
