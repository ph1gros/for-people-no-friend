import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { socialSecretId } from '../src/core/social/social-account-config';
import type { SecretStore } from '../src/main/security/secret-store';
import { SocialConfigStore } from '../src/main/social/social-config-store';
import { createSocialIdHasher } from '../src/main/social/social-identity-hasher';
import type { QqSettingsInput } from '../src/shared/social-ipc';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename), open: vi.fn(actual.open) };
});

const fakeSecrets = () => {
  const entries = new Map<string, string>();
  const store = {
    get: vi.fn(async (id: string) => entries.get(id)),
    has: vi.fn(async (id: string) => entries.has(id)),
    set: vi.fn(async (id: string, value: string) => {
      expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
      entries.set(id, value);
    }),
    delete: vi.fn(async (id: string) => {
      entries.delete(id);
    }),
  } satisfies Pick<SecretStore, 'get' | 'set' | 'has' | 'delete'>;
  return { ...store, entries };
};

const settings = (overrides: Partial<QqSettingsInput> = {}): QqSettingsInput => ({
  characterId: 'character-a',
  appId: '12345',
  enabled: false,
  ...overrides,
});

describe('QQ configuration storage', () => {
  const temporaryRoot = path.resolve('out', 'social-config-tests');
  let directory: string;
  let filePath: string;
  let secrets: ReturnType<typeof fakeSecrets>;
  let store: SocialConfigStore;

  beforeEach(async () => {
    vi.mocked(rename).mockReset();
    vi.mocked(open).mockReset();
    await mkdir(temporaryRoot, { recursive: true });
    directory = await mkdtemp(path.join(temporaryRoot, 'qq-config-'));
    filePath = path.join(directory, 'social-config.v1.json');
    secrets = fakeSecrets();
    store = new SocialConfigStore(directory, secrets);
  });

  afterEach(async () => {
    vi.mocked(rename).mockReset();
    vi.mocked(open).mockReset();
    const resolved = path.resolve(directory);
    if (
      path.dirname(resolved) !== temporaryRoot ||
      !path.basename(resolved).startsWith('qq-config-')
    ) {
      throw new Error('Invalid test cleanup target.');
    }
    await rm(resolved, { recursive: true, force: true });
  });

  it('defaults to disabled and unbound, and persists the salt on first access only', async () => {
    expect(await store.get('character-a')).toEqual({
      characterId: 'character-a',
      appId: '',
      enabled: false,
      ownerBindingCount: 0,
      hasSecret: false,
      voiceReplyEnabled: false,
    });
    const salt = await store.getIdentitySalt();
    expect(salt).toMatch(/^[a-f0-9]{64}$/);
    const initial = await readFile(filePath, 'utf8');
    const restart = new SocialConfigStore(directory, secrets);
    expect(await restart.getIdentitySalt()).toBe(salt);
    expect(await restart.getOwnerTokens('character-a')).toEqual([]);
    expect(await restart.getCredentials('character-a')).toBeUndefined();
    expect(await readFile(filePath, 'utf8')).toBe(initial);
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it('stores only salted owner tokens and nonsecret settings and restores them on restart', async () => {
    const owners = ['fake-qq-owner-alpha', 'fake-qq-owner-beta'];
    const result = await store.save(
      settings({
        enabled: true,
        appSecret: 'fake-app-secret-alpha',
        ownerUserIds: [...owners, owners[0]],
      }),
    );
    expect(result).toEqual({
      characterId: 'character-a',
      appId: '12345',
      enabled: true,
      ownerBindingCount: 2,
      hasSecret: true,
      voiceReplyEnabled: false,
    });
    const salt = await store.getIdentitySalt();
    const expectedTokens = owners.map((owner) => createSocialIdHasher(salt)('qq', owner));
    expect(await store.getOwnerTokens('character-a')).toEqual(expectedTokens);
    const text = await readFile(filePath, 'utf8');
    for (const privateValue of [...owners, 'fake-app-secret-alpha', 'ownerUserIds', 'appSecret']) {
      expect(text).not.toContain(privateValue);
      expect(JSON.stringify(result)).not.toContain(privateValue);
    }
    expect(JSON.stringify(result)).not.toContain('ownerTokens');
    for (const token of expectedTokens) expect(text).toContain(token);
    const restart = new SocialConfigStore(directory, secrets);
    expect(await restart.get('character-a')).toEqual(result);
    expect(await restart.getOwnerTokens('character-a')).toEqual(expectedTokens);
    expect(await restart.getIdentitySalt()).toBe(salt);
    expect(await restart.getCredentials('character-a')).toEqual({
      appId: '12345',
      appSecret: 'fake-app-secret-alpha',
    });
    const tokens = await restart.getOwnerTokens('character-a');
    tokens.push('unexpected-token');
    expect(await store.getOwnerTokens('character-a')).toEqual(expectedTokens);
  });

  it('preserves omitted enrollment, clears explicit empty owners, and never binds other characters', async () => {
    await store.save(
      settings({ appSecret: 'fake-preserved-secret', ownerUserIds: ['fake-owner'] }),
    );
    const tokens = await store.getOwnerTokens('character-a');
    expect((await store.save(settings({ enabled: true }))).ownerBindingCount).toBe(1);
    expect(await store.getOwnerTokens('character-a')).toEqual(tokens);
    expect(await store.getOwnerTokens('character-b')).toEqual([]);
    const hash = createSocialIdHasher(await store.getIdentitySalt());
    expect(tokens).not.toContain(hash('qq', 'fake-unbound-user'));
    expect(await store.save(settings({ ownerUserIds: [] }))).toMatchObject({
      ownerBindingCount: 0,
      hasSecret: true,
    });
    expect(await store.getOwnerTokens('character-a')).toEqual([]);
    expect(await store.getCredentials('character-a')).toEqual({
      appId: '12345',
      appSecret: 'fake-preserved-secret',
    });
  });

  it('hashes character IDs into isolated secret slots of at most 64 characters', async () => {
    const characterIds = ['Character_A', 'character_a', 'x'.repeat(64), '__proto__', 'constructor'];
    for (const [index, characterId] of characterIds.entries()) {
      await store.save(settings({ characterId, appSecret: `fake-isolated-secret-${index}` }));
    }
    expect(secrets.entries.size).toBe(characterIds.length);
    const prefix = `${socialSecretId('qq', 'app-secret')}-`;
    for (const [index, characterId] of characterIds.entries()) {
      const slot =
        prefix +
        createHash('sha256')
          .update(characterId)
          .digest('hex')
          .slice(0, 64 - prefix.length);
      expect(secrets.entries.get(slot)).toBe(`fake-isolated-secret-${index}`);
      expect(slot.length).toBeLessThanOrEqual(64);
      expect(await store.getCredentials(characterId)).toEqual({
        appId: '12345',
        appSecret: `fake-isolated-secret-${index}`,
      });
    }
    expect(await store.deleteSecret('Character_A')).toMatchObject({ hasSecret: false });
    expect(await store.getCredentials('Character_A')).toBeUndefined();
    expect(await store.getCredentials('character_a')).toEqual({
      appId: '12345',
      appSecret: 'fake-isolated-secret-1',
    });
    expect(await new SocialConfigStore(directory, secrets).get('__proto__')).toMatchObject({
      characterId: '__proto__',
      appId: '12345',
      hasSecret: true,
    });
  });

  it('clears app-specific owners and the old secret when the App ID changes', async () => {
    await store.save(settings({ appSecret: 'fake-old-secret', ownerUserIds: ['fake-old-owner'] }));
    expect(await store.save(settings({ appId: '54321' }))).toMatchObject({
      appId: '54321',
      ownerBindingCount: 0,
      hasSecret: false,
      voiceReplyEnabled: false,
    });
    expect(await store.getCredentials('character-a')).toBeUndefined();
    expect(await store.getOwnerTokens('character-a')).toEqual([]);
    expect(secrets.entries.size).toBe(0);
    const restart = new SocialConfigStore(directory, secrets);
    expect(await restart.get('character-a')).toMatchObject({
      appId: '54321',
      ownerBindingCount: 0,
      hasSecret: false,
      voiceReplyEnabled: false,
    });
  });

  it.each([
    { appSecret: 'fake-new-secret' },
    { ownerUserIds: ['fake-new-owner'] },
    { appSecret: 'fake-new-secret', ownerUserIds: ['fake-new-owner'] },
  ])('uses only explicitly supplied reenrollment on App ID changes: %j', async (replacement) => {
    await store.save(settings({ appSecret: 'fake-old-secret', ownerUserIds: ['fake-old-owner'] }));
    const result = await store.save(settings({ appId: '54321', ...replacement }));
    expect(result.hasSecret).toBe(replacement.appSecret !== undefined);
    expect(result.ownerBindingCount).toBe(replacement.ownerUserIds ? 1 : 0);
    const hash = createSocialIdHasher(await store.getIdentitySalt());
    expect(await store.getOwnerTokens('character-a')).toEqual(
      replacement.ownerUserIds ? [hash('qq', 'fake-new-owner')] : [],
    );
    expect(await store.getCredentials('character-a')).toEqual(
      replacement.appSecret ? { appId: '54321', appSecret: 'fake-new-secret' } : undefined,
    );
  });

  it('clears enrollment when an account is returned to unconfigured', async () => {
    await store.save(settings({ appSecret: 'fake-secret', ownerUserIds: ['fake-owner'] }));
    expect(await store.save(settings({ appId: '' }))).toMatchObject({
      appId: '',
      ownerBindingCount: 0,
      hasSecret: false,
      voiceReplyEnabled: false,
    });
  });

  it('serializes simultaneous initialization and writes across instances without losing characters', async () => {
    const other = new SocialConfigStore(directory, secrets);
    const salts = await Promise.all(
      Array.from({ length: 12 }, (_, index) => (index % 2 ? other : store).getIdentitySalt()),
    );
    expect(new Set(salts).size).toBe(1);
    expect(rename).toHaveBeenCalledTimes(1);
    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        (index % 2 ? other : store).save(
          settings({
            characterId: `character-${index}`,
            ownerUserIds: [`fake-owner-${index}`],
          }),
        ),
      ),
    );
    const persisted = JSON.parse(await readFile(filePath, 'utf8'));
    expect(Object.keys(persisted.qq)).toHaveLength(24);
    expect(persisted.identitySalt).toBe(salts[0]);
    await Promise.all([
      store.save(settings({ enabled: false, ownerUserIds: ['fake-latest-owner'] })),
      other.save(settings({ enabled: true })),
    ]);
    expect(await store.get('character-a')).toMatchObject({ enabled: true, ownerBindingCount: 1 });
    expect(await readdir(directory)).toEqual(['social-config.v1.json']);
  });

  it('copies the requested character and owners before a queued save', async () => {
    const input = settings({ ownerUserIds: ['fake-original-owner'] });
    const pending = store.save(input);
    input.characterId = 'character-b';
    input.ownerUserIds?.push('fake-added-owner');
    expect(await pending).toMatchObject({ characterId: 'character-a', ownerBindingCount: 1 });
    expect(await store.getOwnerTokens('character-b')).toEqual([]);
  });

  it('writes a synced temporary file before rename and cleans failed writes without replacing the file', async () => {
    await store.save(settings({ appSecret: 'fake-old-secret', ownerUserIds: ['fake-old-owner'] }));
    const initial = await readFile(filePath, 'utf8');
    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockImplementationOnce(async (source, destination) => {
      expect(destination).toBe(filePath);
      expect(await readFile(filePath, 'utf8')).toBe(initial);
      expect(String(source)).toMatch(/social-config\.v1\.json\.[a-f0-9-]+\.tmp$/);
      expect(JSON.parse(await readFile(source, 'utf8')).qq['character-a'].appId).toBe('54321');
      throw new Error('fake rename failure');
    });
    await expect(
      store.save(settings({ appId: '54321', appSecret: 'fake-new-secret' })),
    ).rejects.toThrow();
    expect(await readFile(filePath, 'utf8')).toBe(initial);
    expect(await store.getCredentials('character-a')).toEqual({
      appId: '12345',
      appSecret: 'fake-old-secret',
    });
    expect(await readdir(directory)).toEqual(['social-config.v1.json']);

    const order: string[] = [];
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await actualFs.open(...args);
      if (args[1] === 'wx') {
        const originalSync = handle.sync.bind(handle);
        vi.spyOn(handle, 'sync').mockImplementation(async () => {
          await originalSync();
          order.push('sync');
        });
      }
      return handle;
    });
    vi.mocked(rename).mockImplementationOnce(async (...args) => {
      order.push('rename');
      await actualFs.rename(...args);
    });
    await store.save(settings({ enabled: true }));
    expect(order).toEqual(['sync', 'rename']);
    expect(await store.get('character-a')).toMatchObject({ enabled: true, ownerBindingCount: 1 });
  });

  it('cleans a failed sync and restores both a deleted secret and previous bindings', async () => {
    await store.save(settings({ appSecret: 'fake-old-secret', ownerUserIds: ['fake-old-owner'] }));
    const original = await readFile(filePath, 'utf8');
    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(open).mockImplementation(async (...args) => {
      const handle = await actualFs.open(...args);
      if (args[1] === 'wx')
        vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('fake sync failure'));
      return handle;
    });
    await expect(store.save(settings({ appId: '54321' }))).rejects.toThrow();
    expect(await readFile(filePath, 'utf8')).toBe(original);
    expect(await store.getCredentials('character-a')).toEqual({
      appId: '12345',
      appSecret: 'fake-old-secret',
    });
    expect(await readdir(directory)).toEqual(['social-config.v1.json']);
  });

  it('removes a newly added secret if configuration persistence fails', async () => {
    await store.getIdentitySalt();
    vi.mocked(rename).mockRejectedValueOnce(new Error('fake rename failure'));
    await expect(store.save(settings({ appSecret: 'fake-new-secret' }))).rejects.toThrow();
    expect(secrets.entries.size).toBe(0);
    expect(await store.get('character-a')).toMatchObject({ appId: '', hasSecret: false });
  });

  it('does not persist requested settings when encrypted storage fails, and the queue recovers', async () => {
    await store.save(settings());
    const initial = await readFile(filePath, 'utf8');
    secrets.set.mockRejectedValueOnce(new Error('fake secure storage unavailable'));
    await expect(
      store.save(
        settings({ enabled: true, appSecret: 'fake-secret', ownerUserIds: ['fake-owner'] }),
      ),
    ).rejects.toThrow();
    expect(await readFile(filePath, 'utf8')).toBe(initial);
    expect(await store.save(settings({ enabled: true }))).toMatchObject({
      enabled: true,
      ownerBindingCount: 0,
    });
  });

  it.each([
    '',
    '{broken',
    'null',
    '[]',
    JSON.stringify({ version: 2, identitySalt: 'a'.repeat(64), qq: {} }),
    JSON.stringify({ version: 1, qq: {} }),
    JSON.stringify({ version: 1, identitySalt: 'invalid', qq: {} }),
    JSON.stringify({ version: 1, identitySalt: 'a'.repeat(64), qq: [] }),
    JSON.stringify({
      version: 1,
      identitySalt: 'a'.repeat(64),
      qq: { 'character-a': { appId: '12345', enabled: false, ownerTokens: ['fake-raw-owner'] } },
    }),
    JSON.stringify({
      version: 1,
      identitySalt: 'a'.repeat(64),
      qq: {
        'character-a': {
          appId: '12345',
          enabled: false,
          ownerTokens: [],
          ownerUserIds: ['fake-raw-owner'],
        },
      },
    }),
    JSON.stringify({
      version: 1,
      identitySalt: 'a'.repeat(64),
      qq: { '../escape': { appId: '12345', enabled: false, ownerTokens: [] } },
    }),
  ])('rejects corrupted persisted data without regenerating the salt (%#)', async (corrupt) => {
    await writeFile(filePath, corrupt, 'utf8');
    await expect(store.getIdentitySalt()).rejects.toThrow('social configuration store');
    await expect(store.save(settings({ appSecret: 'fake-secret' }))).rejects.toThrow();
    await expect(new SocialConfigStore(directory, secrets).get('character-a')).rejects.toThrow();
    expect(await readFile(filePath, 'utf8')).toBe(corrupt);
    expect(rename).not.toHaveBeenCalled();
    expect(secrets.set).not.toHaveBeenCalled();
  });

  it('rejects oversized files without rewriting them', async () => {
    const corrupt = ' '.repeat(1_048_577);
    await writeFile(filePath, corrupt, 'utf8');
    await expect(store.getIdentitySalt()).rejects.toThrow();
    expect((await readFile(filePath)).length).toBe(corrupt.length);
    expect(rename).not.toHaveBeenCalled();
  });

  it('fails closed if the salt changes or the initialized file disappears', async () => {
    const salt = await store.getIdentitySalt();
    const original = await readFile(filePath, 'utf8');
    const altered = JSON.parse(original);
    altered.identitySalt = salt === 'a'.repeat(64) ? 'b'.repeat(64) : 'a'.repeat(64);
    await writeFile(filePath, JSON.stringify(altered), 'utf8');
    await expect(store.getIdentitySalt()).rejects.toThrow();
    await writeFile(filePath, original, 'utf8');
    await rm(filePath);
    await expect(store.getIdentitySalt()).rejects.toThrow();
    await expect(readFile(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['', '../escape', 'a/b', 'a\\b', 'x'.repeat(65), 'a.b', 123, null])(
    'validates every character-scoped method before storage (%#)',
    async (characterId) => {
      await expect(store.get(characterId as string)).rejects.toThrow();
      await expect(store.save(settings({ characterId: characterId as string }))).rejects.toThrow();
      await expect(store.deleteSecret(characterId as string)).rejects.toThrow();
      await expect(store.getCredentials(characterId as string)).rejects.toThrow();
      await expect(store.getOwnerTokens(characterId as string)).rejects.toThrow();
      expect(secrets.get).not.toHaveBeenCalled();
      expect(secrets.has).not.toHaveBeenCalled();
      expect(secrets.delete).not.toHaveBeenCalled();
      expect(await readdir(directory)).toEqual([]);
    },
  );

  it.each([
    { appId: '1234' },
    { appId: '1'.repeat(33) },
    { enabled: 'true' },
    { appSecret: '' },
    { ownerUserIds: ['*'] },
    { ownerUserIds: Array(9).fill('fake-owner') },
  ])('validates settings again in the store (%#)', async (invalidInput) => {
    await expect(
      store.save({ ...settings(), ...invalidInput } as QqSettingsInput),
    ).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
    expect(secrets.set).not.toHaveBeenCalled();
  });
});
