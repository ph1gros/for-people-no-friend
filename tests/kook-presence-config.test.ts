import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SecretStore } from '../src/main/security/secret-store';
import { SocialConfigStore } from '../src/main/social/social-config-store';
import { createSocialInstallationSalt } from '../src/main/social/social-identity-hasher';
import {
  KOOK_PRESENCE_PUBLIC_ERROR,
  parseKookPresenceSnapshot,
  parseKookSettingsInput,
} from '../src/shared/social-ipc';

const TOKEN = 'fake-kook-bot-token-value';

const fakeSecrets = () => {
  const entries = new Map<string, string>();
  const store = {
    get: vi.fn(async (id: string) => entries.get(id)),
    has: vi.fn(async (id: string) => entries.has(id)),
    set: vi.fn(async (id: string, value: string) => {
      // Mirrors the identifier rule the real encrypted store enforces.
      expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
      entries.set(id, value);
    }),
    delete: vi.fn(async (id: string) => {
      entries.delete(id);
    }),
  } satisfies Pick<SecretStore, 'get' | 'set' | 'has' | 'delete'>;
  return { ...store, entries };
};

describe('KOOK configuration storage', () => {
  const temporaryRoot = path.resolve('out', 'social-config-tests');
  let directory: string;
  let filePath: string;
  let secrets: ReturnType<typeof fakeSecrets>;
  let store: SocialConfigStore;

  beforeEach(async () => {
    await mkdir(temporaryRoot, { recursive: true });
    directory = await mkdtemp(path.join(temporaryRoot, 'kook-config-'));
    filePath = path.join(directory, 'social-config.v1.json');
    secrets = fakeSecrets();
    store = new SocialConfigStore(directory, secrets);
  });

  afterEach(async () => {
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(temporaryRoot))) {
      throw new Error('Invalid test cleanup target.');
    }
    await rm(resolved, { recursive: true, force: true });
  });

  it('defaults to disabled, unbound and without a stored token', async () => {
    expect(await store.getKook('character-a')).toEqual({
      characterId: 'character-a',
      enabled: false,
      ownerBindingCount: 0,
      hasToken: false,
    });
  });

  it('stores the token encrypted and keeps only salted owner tokens on disk', async () => {
    const saved = await store.saveKook({
      characterId: 'character-a',
      enabled: true,
      botToken: TOKEN,
      ownerUserIds: ['kook-owner-1', 'kook-owner-2', 'kook-owner-1'],
    });

    expect(saved).toEqual({
      characterId: 'character-a',
      enabled: true,
      ownerBindingCount: 2,
      hasToken: true,
    });

    const onDisk = await readFile(filePath, 'utf8');
    expect(onDisk).not.toContain(TOKEN);
    expect(onDisk).not.toContain('kook-owner-1');
    const parsed = JSON.parse(onDisk) as { kook: Record<string, { ownerTokens: string[] }> };
    for (const token of parsed.kook['character-a']?.ownerTokens ?? []) {
      expect(token).toMatch(/^[a-f0-9]{24}$/);
    }
    expect(await store.getKookToken('character-a')).toBe(TOKEN);
  });

  it('keeps the QQ and KOOK credentials in separate slots', async () => {
    await store.save({
      characterId: 'character-a',
      appId: '12345',
      enabled: true,
      appSecret: 'qq-secret',
    });
    await store.saveKook({ characterId: 'character-a', enabled: true, botToken: TOKEN });

    expect(secrets.entries.size).toBe(2);
    expect((await store.get('character-a')).hasSecret).toBe(true);
    expect((await store.getKook('character-a')).hasToken).toBe(true);

    await store.deleteKookSecret('character-a');
    expect((await store.getKook('character-a')).hasToken).toBe(false);
    // Deleting one platform credential must not disturb the other.
    expect((await store.get('character-a')).hasSecret).toBe(true);
  });

  it('preserves an omitted token and omitted owner bindings', async () => {
    await store.saveKook({
      characterId: 'character-a',
      enabled: true,
      botToken: TOKEN,
      ownerUserIds: ['kook-owner-1'],
    });

    const updated = await store.saveKook({ characterId: 'character-a', enabled: false });

    expect(updated).toEqual({
      characterId: 'character-a',
      enabled: false,
      ownerBindingCount: 1,
      hasToken: true,
    });
    expect(await store.getKookToken('character-a')).toBe(TOKEN);

    const cleared = await store.saveKook({
      characterId: 'character-a',
      enabled: false,
      ownerUserIds: [],
    });
    expect(cleared.ownerBindingCount).toBe(0);
  });

  it('reads a configuration file written before KOOK existed', async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        identitySalt: createSocialInstallationSalt(),
        qq: { 'character-a': { appId: '12345', enabled: true, ownerTokens: [] } },
      }),
      'utf8',
    );

    expect(await store.getKook('character-a')).toMatchObject({ enabled: false, hasToken: false });
    expect((await store.get('character-a')).appId).toBe('12345');
  });

  it('rejects a corrupted KOOK partition instead of guessing', async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        identitySalt: createSocialInstallationSalt(),
        qq: {},
        kook: { 'character-a': { enabled: true, ownerTokens: ['not-a-digest'] } },
      }),
      'utf8',
    );

    await expect(store.getKook('character-a')).rejects.toThrow();
  });

  it('keeps owner bindings isolated per character', async () => {
    await store.saveKook({
      characterId: 'character-a',
      enabled: true,
      ownerUserIds: ['kook-owner-1'],
    });
    await store.saveKook({ characterId: 'character-b', enabled: true });

    expect(await store.getKookOwnerTokens('character-a')).toHaveLength(1);
    expect(await store.getKookOwnerTokens('character-b')).toEqual([]);
  });
});

describe('KOOK presence IPC contract', () => {
  it('accepts a well formed settings payload and trims the token', () => {
    expect(
      parseKookSettingsInput({
        characterId: 'character-a',
        enabled: true,
        botToken: `  ${TOKEN}  `,
        ownerUserIds: ['owner-1', 'owner-1'],
      }),
    ).toEqual({
      characterId: 'character-a',
      enabled: true,
      botToken: TOKEN,
      ownerUserIds: ['owner-1'],
    });
  });

  it('refuses a masked placeholder, whitespace or control characters as a token', () => {
    for (const botToken of [
      '',
      '   ',
      'short',
      '********',
      '••••••••',
      'has space here',
      'bad\u0000token',
      42,
    ]) {
      expect(() =>
        parseKookSettingsInput({ characterId: 'character-a', enabled: true, botToken }),
      ).toThrow();
    }
  });

  it('refuses malformed owner lists and character IDs', () => {
    expect(() =>
      parseKookSettingsInput({ characterId: 'character-a', enabled: true, ownerUserIds: 'x' }),
    ).toThrow();
    expect(() =>
      parseKookSettingsInput({
        characterId: 'character-a',
        enabled: true,
        ownerUserIds: ['bad id'],
      }),
    ).toThrow();
    expect(() => parseKookSettingsInput({ characterId: '', enabled: true })).toThrow();
  });

  it('projects a snapshot to public fields and replaces untrusted error details', () => {
    expect(
      parseKookPresenceSnapshot({
        configuration: {
          characterId: 'character-a',
          enabled: true,
          ownerBindingCount: 1,
          hasToken: true,
          leaked: 'must not survive',
        },
        state: 'error',
        errorMessage: 'Bot token 12345 rejected by upstream',
        extra: 'dropped',
      }),
    ).toEqual({
      configuration: {
        characterId: 'character-a',
        enabled: true,
        ownerBindingCount: 1,
        hasToken: true,
      },
      state: 'error',
      errorMessage: KOOK_PRESENCE_PUBLIC_ERROR,
    });
  });

  it('refuses an unknown connection state', () => {
    expect(() =>
      parseKookPresenceSnapshot({
        configuration: {
          characterId: 'character-a',
          enabled: false,
          ownerBindingCount: 0,
          hasToken: false,
        },
        state: 'exploded',
      }),
    ).toThrow();
  });
});
