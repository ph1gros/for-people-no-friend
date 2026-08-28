import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_CHARACTER_PROFILE,
  KALTSIT_CHARACTER_PROFILE,
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

  it('loads the default profile and persists validated edits', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-profile-test-'));
    const store = new CharacterProfileStore(directory);
    expect(await store.get()).toEqual(KALTSIT_CHARACTER_PROFILE);

    await store.set({
      ...KALTSIT_CHARACTER_PROFILE,
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

  it('migrates the obsolete bundled profile to the complete Kaltsit example', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-profile-obsolete-migration-'));
    await writeFile(
      path.join(directory, 'character-profiles.live2d.v1.json'),
      JSON.stringify({
        version: 1,
        activeProfileId: 'm3',
        profiles: [
          {
            ...DEFAULT_CHARACTER_PROFILE,
            id: 'm3',
            name: '旧角色',
            memoryNamespace: 'character-m3',
            lore: {
              canonicalName: 'Mon3tr',
              aliases: [],
              sourceWork: '旧资料',
              identity: '待迁移',
              personality: '',
              background: '',
              relationships: [],
              speechStyle: '',
              sources: [],
            },
          },
        ],
      }),
      'utf8',
    );

    const store = new CharacterProfileStore(directory);

    expect(await store.get()).toEqual(KALTSIT_CHARACTER_PROFILE);
  });

  it('migrates a custom character that inherited another persona namespace', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-profile-namespace-migration-'));
    await writeFile(
      path.join(directory, 'character-profiles.live2d.v1.json'),
      JSON.stringify({
        version: 1,
        activeProfileId: KALTSIT_CHARACTER_PROFILE.id,
        profiles: [
          {
            ...KALTSIT_CHARACTER_PROFILE,
            name: '芙宁娜',
            userDisplayName: '旅行者',
            memoryNamespace: 'character-kaltsit',
            lore: {
              ...KALTSIT_CHARACTER_PROFILE.lore,
              canonicalName: '芙宁娜',
              sourceWork: '原神',
            },
          },
        ],
      }),
      'utf8',
    );

    const profile = await new CharacterProfileStore(directory).get();
    expect(profile.memoryNamespace).toMatch(/^character-[a-f0-9]{24}$/u);
    expect(profile.memoryNamespace).not.toBe('character-kaltsit');
  });

  it('keeps the Live2D profile separate from the GIF Version profile file', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-profile-separated-'));
    await writeFile(
      path.join(directory, 'character-profiles.v5.json'),
      JSON.stringify({
        version: 5,
        activeProfileId: 'irena',
        profiles: [
          { ...DEFAULT_CHARACTER_PROFILE, name: 'Live2D 角色' },
          { ...KALTSIT_CHARACTER_PROFILE, id: 'irena', live2dModelId: 'irena-webp-v1' },
        ],
      }),
      'utf8',
    );
    const store = new CharacterProfileStore(directory);
    expect(await store.get()).toMatchObject({ id: 'default-character', name: 'Live2D 角色' });

    await store.set(DEFAULT_CHARACTER_PROFILE);
    const shared = JSON.parse(
      await readFile(path.join(directory, 'character-profiles.v5.json'), 'utf8'),
    ) as { activeProfileId: string };
    expect(shared.activeProfileId).toBe('irena');
  });

  it('exposes the V1.4 profile library surface on main', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-profile-switch-'));
    const store = new CharacterProfileStore(directory);
    expect(await store.get()).toMatchObject({ id: 'kaltsit', live2dModelId: 'local-model' });
    expect('list' in store).toBe(true);
    expect('activate' in store).toBe(true);
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
