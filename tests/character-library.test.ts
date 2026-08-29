import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  KALTSIT_CHARACTER_PROFILE,
  validateCharacterProfile,
} from '../src/core/conversation/character-profile';
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

  it('repairs an incomplete generated speech-style fragment in an existing profile', () => {
    const validated = validateCharacterProfile({
      ...KALTSIT_CHARACTER_PROFILE,
      personaPrompt: `${KALTSIT_CHARACTER_PROFILE.personaPrompt}\n说话方式：称呼用户为`,
      lore: { ...KALTSIT_CHARACTER_PROFILE.lore!, speechStyle: '称呼用户为' },
    });

    expect(validated.lore?.speechStyle).toBe(KALTSIT_CHARACTER_PROFILE.lore?.speechStyle);
    expect(validated.personaPrompt).not.toMatch(/说话方式：称呼用户为$/u);
    expect(validated.personaPrompt).toContain(KALTSIT_CHARACTER_PROFILE.lore!.speechStyle);
  });

  it('repairs a longer speech-style fragment that still ends before the actual form of address', () => {
    const validated = validateCharacterProfile({
      ...KALTSIT_CHARACTER_PROFILE,
      name: '春日野穹',
      userDisplayName: '悠',
      personaPrompt: '性格：安静而依赖亲近的人。\n说话方式：对哥哥春日野悠直呼',
      lore: {
        ...KALTSIT_CHARACTER_PROFILE.lore!,
        canonicalName: '春日野穹',
        sourceWork: '缘之空',
        speechStyle: '对哥哥春日野悠直呼',
      },
    });

    expect(validated.lore?.speechStyle).toBe('通常直接称用户为“悠”。');
    expect(validated.personaPrompt).toBe(
      '性格：安静而依赖亲近的人。\n说话方式：通常直接称用户为“悠”。',
    );
  });
});
