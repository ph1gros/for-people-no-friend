import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

  it('loads the default profile and persists validated edits', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-profile-test-'));
    const store = new CharacterProfileStore(directory);
    expect(await store.get()).toEqual(DEFAULT_CHARACTER_PROFILE);

    await store.set({
      ...DEFAULT_CHARACTER_PROFILE,
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

  it('loads an M4/M5 profile without the optional M5.1 lore fields', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-profile-migration-'));
    await writeFile(
      path.join(directory, 'character-profile.v1.json'),
      JSON.stringify({
        version: 1,
        profile: {
          id: 'default-character',
          name: '旧角色',
          userDisplayName: '你',
          bio: '旧简介',
          personaPrompt: '旧人格',
          live2dModelId: 'local-model',
          memoryNamespace: 'default-character',
        },
      }),
      'utf8',
    );
    const store = new CharacterProfileStore(directory);
    expect(await store.get()).toMatchObject({ name: '旧角色' });
    expect((await store.get()).lore).toBeUndefined();
  });

  it('keeps versioned character profiles separate when switching', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-profile-switch-'));
    const store = new CharacterProfileStore(directory);
    expect(await store.list()).toEqual([
      expect.objectContaining({ id: 'default-character', active: true }),
      expect.objectContaining({ id: 'irena', appearanceId: 'irena-webp-v1', active: false }),
    ]);

    await store.activate('irena');
    expect(await store.get()).toEqual(IRENA_CHARACTER_PROFILE);
    await store.set({ ...IRENA_CHARACTER_PROFILE, userDisplayName: '旅行者' });
    expect(await store.get()).toMatchObject({ id: 'irena', userDisplayName: '旅行者' });

    await store.activate('default-character');
    expect(await store.get()).toEqual(DEFAULT_CHARACTER_PROFILE);
  });

  it('adds the built-in Irena lore once when upgrading a version 2 profile file', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-profile-v2-upgrade-'));
    const oldIrena = { ...IRENA_CHARACTER_PROFILE, lore: undefined };
    await writeFile(
      path.join(directory, 'character-profiles.v2.json'),
      JSON.stringify({
        version: 2,
        activeProfileId: 'irena',
        profiles: [DEFAULT_CHARACTER_PROFILE, oldIrena],
      }),
      'utf8',
    );

    const store = new CharacterProfileStore(directory);
    expect((await store.get()).lore).toMatchObject({
      canonicalName: '伊雷娜',
      sourceWork: '魔女之旅',
    });

    await store.set({ ...IRENA_CHARACTER_PROFILE, lore: undefined });
    expect((await store.get()).lore).toBeUndefined();
  });

  it('adds short dialogue examples once when upgrading the built-in version 3 Irena profile', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-profile-v3-upgrade-'));
    await writeFile(
      path.join(directory, 'character-profiles.v3.json'),
      JSON.stringify({
        version: 3,
        activeProfileId: 'irena',
        profiles: [
          DEFAULT_CHARACTER_PROFILE,
          {
            ...IRENA_CHARACTER_PROFILE,
            lore: { ...IRENA_CHARACTER_PROFILE.lore, sampleLines: undefined },
          },
        ],
      }),
      'utf8',
    );

    const store = new CharacterProfileStore(directory);
    expect((await store.get()).lore?.sampleLines).toEqual(
      IRENA_CHARACTER_PROFILE.lore?.sampleLines,
    );

    await store.set({
      ...IRENA_CHARACTER_PROFILE,
      lore: { ...IRENA_CHARACTER_PROFILE.lore!, sampleLines: [] },
    });
    expect((await store.get()).lore?.sampleLines).toEqual([]);
  });

  it('adds structured roleplay examples once when upgrading the built-in version 4 Irena profile', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-profile-v4-upgrade-'));
    await writeFile(
      path.join(directory, 'character-profiles.v4.json'),
      JSON.stringify({
        version: 4,
        activeProfileId: 'irena',
        profiles: [
          DEFAULT_CHARACTER_PROFILE,
          {
            ...IRENA_CHARACTER_PROFILE,
            lore: { ...IRENA_CHARACTER_PROFILE.lore, roleplayExamples: undefined },
          },
        ],
      }),
      'utf8',
    );

    const store = new CharacterProfileStore(directory);
    expect((await store.get()).lore?.roleplayExamples).toEqual(
      IRENA_CHARACTER_PROFILE.lore?.roleplayExamples,
    );

    await store.set({
      ...IRENA_CHARACTER_PROFILE,
      lore: { ...IRENA_CHARACTER_PROFILE.lore!, roleplayExamples: [] },
    });
    expect((await store.get()).lore?.roleplayExamples).toEqual([]);
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
