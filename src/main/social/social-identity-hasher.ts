import { createHash, randomBytes } from 'node:crypto';

import type { SocialIdHasher, SocialPlatform } from '../../core/social/social-contracts';

const SALT_PATTERN = /^[a-f0-9]{32,128}$/;
const TOKEN_LENGTH = 24;

/**
 * Generates the per-installation salt for social identity tokens. Platform user IDs such as QQ
 * numbers come from a small, guessable space, so an unsalted digest could be reversed by anybody
 * who reads the stored memory namespaces. The salt is created once and kept with app data.
 */
export const createSocialInstallationSalt = (): string => randomBytes(32).toString('hex');

/**
 * Turns a raw platform identifier into an opaque token. The raw ID stays inside the adapter; only
 * the token is allowed to reach memory namespaces, diagnostics or persisted configuration.
 */
export const createSocialIdHasher = (salt: string): SocialIdHasher => {
  if (!SALT_PATTERN.test(salt)) {
    throw new Error('The social identity salt is invalid.');
  }
  return (platform: SocialPlatform, value: string): string =>
    createHash('sha256')
      .update(`${salt}\u0000${platform}\u0000${value}`, 'utf8')
      .digest('hex')
      .slice(0, TOKEN_LENGTH);
};
