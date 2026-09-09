import { describe, expect, it } from 'vitest';

import {
  MAX_SOCIAL_OWNER_ACCOUNTS,
  createDefaultSocialPresenceConfig,
  parseSocialAccountConfig,
  parseSocialPresenceConfig,
  socialSecretId,
} from '../src/core/social/social-account-config';
import { SOCIAL_PLATFORMS } from '../src/core/social/social-contracts';
import {
  describeSocialError,
  maskSocialSecret,
  redactSocialSecrets,
} from '../src/core/social/social-redaction';

/** Mirrors the identifier rule enforced by the encrypted secret store. */
const SECRET_STORE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

describe('social credential identifiers', () => {
  it('produces IDs the encrypted secret store accepts', () => {
    const ids = [
      socialSecretId('qq', 'app-secret'),
      socialSecretId('kook', 'bot-token'),
      socialSecretId('oopz', 'password'),
    ];

    expect(ids).toEqual(['social-qq-app-secret', 'social-kook-bot-token', 'social-oopz-password']);
    for (const id of ids) {
      expect(SECRET_STORE_ID_PATTERN.test(id)).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('social presence configuration', () => {
  it('starts disabled on every platform with the conservative reply policy', () => {
    const config = createDefaultSocialPresenceConfig('default-character');

    expect(config.accounts.map(({ platform }) => platform)).toEqual([...SOCIAL_PLATFORMS]);
    expect(config.accounts.every(({ enabled }) => enabled === false)).toBe(true);
    expect(config.accounts[0]?.replyPolicy.requireMentionInGroups).toBe(true);
    expect(config.bindings).toEqual([]);
  });

  it('round-trips a valid configuration and keeps only non-secret fields', () => {
    const parsed = parseSocialPresenceConfig({
      version: 1,
      characterId: 'character-1',
      accounts: [
        {
          platform: 'qq',
          enabled: true,
          accountId: '102000123',
          ownerUserIds: ['owner-1', 'owner-1', 'owner-2'],
          replyPolicy: {
            respondInDirectMessages: true,
            requireMentionInGroups: true,
            respondToUnknownActors: false,
            blockedActorIds: ['qq-abcdef012345'],
          },
          appSecret: 'must-not-survive',
        },
      ],
      bindings: [{ platform: 'qq', userId: 'owner-1', actorClass: 'owner' }],
    });

    expect(parsed.accounts[0]?.ownerUserIds).toEqual(['owner-1', 'owner-2']);
    expect(parsed.accounts[0]).not.toHaveProperty('appSecret');
    expect(JSON.stringify(parsed)).not.toContain('must-not-survive');
  });

  it('rejects malformed accounts, duplicates and oversized lists', () => {
    expect(() => parseSocialAccountConfig({ platform: 'discord', enabled: true })).toThrow();
    expect(() => parseSocialAccountConfig({ platform: 'qq', enabled: 'yes' })).toThrow();
    expect(() =>
      parseSocialAccountConfig({ platform: 'qq', enabled: true, accountId: 'has space' }),
    ).toThrow();
    expect(() =>
      parseSocialAccountConfig({
        platform: 'qq',
        enabled: true,
        ownerUserIds: Array.from({ length: MAX_SOCIAL_OWNER_ACCOUNTS + 1 }, (_, i) => `u${i}`),
      }),
    ).toThrow();

    expect(() =>
      parseSocialPresenceConfig({
        version: 1,
        characterId: 'character-1',
        accounts: [
          { platform: 'qq', enabled: false },
          { platform: 'qq', enabled: true },
        ],
        bindings: [],
      }),
    ).toThrow();
    expect(() =>
      parseSocialPresenceConfig({
        version: 2,
        characterId: 'character-1',
        accounts: [],
        bindings: [],
      }),
    ).toThrow();
    expect(() =>
      parseSocialPresenceConfig({
        version: 1,
        characterId: 'character-1',
        accounts: [],
        bindings: [
          { platform: 'qq', userId: 'same', actorClass: 'owner' },
          { platform: 'qq', userId: 'same', actorClass: 'known-user' },
        ],
      }),
    ).toThrow();
  });
});

describe('social secret redaction', () => {
  it('removes credential shaped values from diagnostics', () => {
    const token = 'C'.repeat(48);

    expect(redactSocialSecrets(`Authorization: Bearer ${token}`)).not.toContain(token);
    expect(redactSocialSecrets(`Bot ${token}`)).not.toContain(token);
    expect(redactSocialSecrets(`botToken=${token}`)).not.toContain(token);
    expect(redactSocialSecrets('password: hunter2000')).toContain('[redacted]');
    expect(redactSocialSecrets('sk-abcdefghijklmnop')).toBe('[redacted]');
  });

  it('leaves ordinary diagnostics readable', () => {
    expect(redactSocialSecrets('websocket closed with code 1006')).toBe(
      'websocket closed with code 1006',
    );
  });

  it('bounds and redacts an arbitrary thrown value', () => {
    expect(describeSocialError(new Error(`fail ${'D'.repeat(60)}`))).toContain('[redacted]');
    expect(describeSocialError('plain failure')).toBe('plain failure');
    expect(describeSocialError({ unexpected: true })).toBe('Unknown error.');
    expect(describeSocialError(new Error('ab '.repeat(400))).length).toBe(300);
  });

  it('masks a stored secret without revealing its length', () => {
    expect(maskSocialSecret('short')).toBe('*'.repeat(8));
    expect(maskSocialSecret('E'.repeat(200))).toBe('*'.repeat(24));
    expect(maskSocialSecret('')).toBe('');
  });
});
