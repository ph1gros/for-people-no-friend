import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { KALTSIT_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';
import { resolveCharacterMemoryNamespace } from '../src/main/character/character-namespace';
import { CharacterProfileStore } from '../src/main/storage/character-profile-store';

describe('Live2D character library', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('adds, activates, persists and removes isolated character profiles', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-character-library-'));
    const store = new CharacterProfileStore(directory);
    const secondWithoutNamespace = {
      ...KALTSIT_CHARACTER_PROFILE,
      id: 'test-character',
      name: '测试角色',
      lore: {
        ...KALTSIT_CHARACTER_PROFILE.lore!,
        canonicalName: '测试角色',
        sourceWork: '测试作品',
      },
    };
    const second = {
      ...secondWithoutNamespace,
      memoryNamespace: resolveCharacterMemoryNamespace(secondWithoutNamespace),
    };

    await store.add(second);
    await expect(store.list()).resolves.toHaveLength(2);
    await expect(store.activate(second.id)).resolves.toMatchObject({ id: second.id });
    await expect(new CharacterProfileStore(directory).get()).resolves.toMatchObject({
      id: second.id,
      memoryNamespace: second.memoryNamespace,
    });

    await store.remove(second.id);
    await expect(store.get()).resolves.toMatchObject({ id: KALTSIT_CHARACTER_PROFILE.id });
  });

  it('rejects duplicate ids and memory namespaces', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-character-library-'));
    const store = new CharacterProfileStore(directory);
    await expect(store.add({ ...KALTSIT_CHARACTER_PROFILE })).rejects.toThrow();
    await expect(
      store.add({
        ...KALTSIT_CHARACTER_PROFILE,
        id: 'another-character',
      }),
    ).rejects.toThrow();
  });
});
