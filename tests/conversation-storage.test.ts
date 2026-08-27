import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_CHARACTER_PROFILE,
  IRENA_CHARACTER_PROFILE,
} from '../src/core/conversation/character-profile';
import { CharacterProfileStore } from '../src/main/storage/character-profile-store';
import { ConversationStore } from '../src/main/storage/conversation-store';

describe('M4 local conversation storage', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it('loads only the GIF Version profile and persists validated edits', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-profile-test-'));
    const store = new CharacterProfileStore(directory);
    expect(await store.get()).toEqual(IRENA_CHARACTER_PROFILE);

    await store.set({
      ...IRENA_CHARACTER_PROFILE,
      name: '测试角色',
      personaPrompt: '保持冷静。',
      lore: {
        canonicalName: '测试角色',
        aliases: ['Test'],
        sourceWork: '测试游戏',
        identity: '测试身份',
        personality: '冷静',
        background: '',
        relationships: [],
        speechStyle: '',
        sources: [],
      },
    });
    expect(await store.get()).toMatchObject({
      name: '测试角色',
      personaPrompt: '保持冷静。',
      lore: { sourceWork: '测试游戏' },
    });
  });

  it('keeps the GIF Version profile separate from the Live2D profile file', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-profile-separated-'));
    await writeFile(
      path.join(directory, 'character-profiles.v5.json'),
      JSON.stringify({
        version: 5,
        activeProfileId: 'default-character',
        profiles: [
          DEFAULT_CHARACTER_PROFILE,
          { ...IRENA_CHARACTER_PROFILE, userDisplayName: '旅行者' },
        ],
      }),
      'utf8',
    );
    const store = new CharacterProfileStore(directory);
    expect(await store.get()).toMatchObject({ id: 'irena', userDisplayName: '旅行者' });

    await store.set({ ...IRENA_CHARACTER_PROFILE, userDisplayName: '你' });
    const shared = JSON.parse(
      await readFile(path.join(directory, 'character-profiles.v5.json'), 'utf8'),
    ) as { activeProfileId: string };
    expect(shared.activeProfileId).toBe('default-character');
  });

  it('migrates a generated WebP persona that inherited the bundled Irena namespace', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-webp-profile-migration-'));
    await writeFile(
      path.join(directory, 'character-profiles.webp.v1.json'),
      JSON.stringify({
        version: 1,
        activeProfileId: IRENA_CHARACTER_PROFILE.id,
        profiles: [
          {
            ...IRENA_CHARACTER_PROFILE,
            name: '芙莉莲',
            memoryNamespace: 'character-irena',
            lore: {
              ...IRENA_CHARACTER_PROFILE.lore,
              canonicalName: '芙莉莲',
              sourceWork: '葬送的芙莉莲',
            },
          },
        ],
      }),
      'utf8',
    );

    const migrated = await new CharacterProfileStore(directory).get();
    expect(migrated.memoryNamespace).toMatch(/^character-[a-f0-9]{24}$/u);
    expect(migrated.memoryNamespace).not.toBe('character-irena');
  });

  it('does not accept a Live2D profile in GIF Version', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-profile-switch-'));
    const store = new CharacterProfileStore(directory);
    await expect(store.set(DEFAULT_CHARACTER_PROFILE)).rejects.toThrow(
      'Only the active character profile can be updated',
    );
    expect(await store.get()).toMatchObject({ id: 'irena', live2dModelId: 'irena-webp-v1' });
  });

  it('serializes concurrent appends and can clear the session', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-history-test-'));
    const store = new ConversationStore(directory);
    await Promise.all([
      store.append({
        id: 'one',
        role: 'user',
        content: '第一条',
        createdAt: 1,
        status: 'complete',
      }),
      store.append({
        id: 'two',
        role: 'assistant',
        content: '第二条',
        createdAt: 2,
        status: 'complete',
        emotion: 'happy',
      }),
    ]);
    expect(await store.list()).toHaveLength(2);
    await store.clear();
    expect(await store.list()).toEqual([]);
    store.close();
  });

  it('isolates conversation history by character namespace', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-history-namespace-'));
    const store = new ConversationStore(directory);
    await store.append(
      {
        id: 'default-message',
        role: 'user',
        content: '默认角色',
        createdAt: 1,
        status: 'complete',
      },
      'default-character',
    );
    await store.append(
      { id: 'irena-message', role: 'user', content: '伊雷娜', createdAt: 2, status: 'complete' },
      'character-irena',
    );
    expect(await store.list(100, 'default-character')).toHaveLength(1);
    expect(await store.list(100, 'character-irena')).toEqual([
      expect.objectContaining({ id: 'irena-message' }),
    ]);
    await store.clear('character-irena');
    expect(await store.list(100, 'default-character')).toHaveLength(1);
    store.close();
  });
});
