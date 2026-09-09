import { describe, expect, it } from 'vitest';

import { SOCIAL_ID_TOKEN_PATTERN } from '../src/core/social/social-contracts';
import {
  createSocialIdHasher,
  createSocialInstallationSalt,
} from '../src/main/social/social-identity-hasher';

describe('social identity hasher', () => {
  it('generates a salt that satisfies its own validation', () => {
    const salt = createSocialInstallationSalt();

    expect(salt).toMatch(/^[a-f0-9]{64}$/);
    expect(createSocialInstallationSalt()).not.toBe(salt);
    expect(() => createSocialIdHasher(salt)).not.toThrow();
  });

  it('rejects a missing or malformed salt', () => {
    expect(() => createSocialIdHasher('')).toThrow('The social identity salt is invalid.');
    expect(() => createSocialIdHasher('not-hex-value')).toThrow();
    expect(() => createSocialIdHasher('ab')).toThrow();
  });

  it('produces stable tokens that the core layer accepts', () => {
    const hash = createSocialIdHasher(createSocialInstallationSalt());
    const token = hash('qq', '10001');

    expect(SOCIAL_ID_TOKEN_PATTERN.test(token)).toBe(true);
    expect(hash('qq', '10001')).toBe(token);
  });

  it('separates platforms, values and installations', () => {
    const saltA = createSocialInstallationSalt();
    const saltB = createSocialInstallationSalt();
    const hashA = createSocialIdHasher(saltA);
    const hashB = createSocialIdHasher(saltB);

    expect(hashA('qq', '10001')).not.toBe(hashA('kook', '10001'));
    expect(hashA('qq', '10001')).not.toBe(hashA('qq', '10002'));
    expect(hashA('qq', '10001')).not.toBe(hashB('qq', '10001'));
  });

  it('never echoes the raw identifier back', () => {
    const hash = createSocialIdHasher(createSocialInstallationSalt());

    expect(hash('qq', 'sensitive-account')).not.toContain('sensitive-account');
  });
});
