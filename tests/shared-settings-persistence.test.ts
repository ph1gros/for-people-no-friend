import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { KALTSIT_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';
import { MemoryService } from '../src/main/memory/memory-service';
import { CharacterProfileStore } from '../src/main/storage/character-profile-store';
import { DeskpetDatabase } from '../src/main/storage/deskpet-database';
import { DesktopIntegrationStore } from '../src/main/storage/desktop-integration-store';
import { ProviderConfigStore } from '../src/main/storage/provider-config-store';
import { WorkGlossaryStore } from '../src/main/storage/work-glossary-store';
import { WindowStateStore } from '../src/main/windows/window-state';

describe('shared settings persistence contract', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('migrates older desktop settings to both default shortcuts', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-desktop-settings-'));
    await writeFile(
      path.join(directory, 'desktop-integrations.v1.json'),
      JSON.stringify({
        version: 1,
        settings: { globalShortcutsEnabled: true, mediaControlEnabled: false },
      }),
      'utf8',
    );

    await expect(new DesktopIntegrationStore(directory).get()).resolves.toEqual({
      globalShortcutsEnabled: true,
      mediaControlEnabled: false,
      visibilityShortcut: '\\',
      stopGenerationShortcut: 'Ctrl+Shift+Delete',
    });

    await writeFile(
      path.join(directory, 'desktop-integrations.v1.json'),
      JSON.stringify({
        version: 2,
        settings: {
          globalShortcutsEnabled: true,
          mediaControlEnabled: false,
          visibilityShortcut: 'Ctrl+Shift+]',
        },
      }),
      'utf8',
    );
    await expect(new DesktopIntegrationStore(directory).get()).resolves.toEqual({
      globalShortcutsEnabled: true,
      mediaControlEnabled: false,
      visibilityShortcut: 'Ctrl+Shift+]',
      stopGenerationShortcut: 'Ctrl+Shift+Delete',
    });
  });

  it('restores window, provider, character, memory and glossary state after reopening stores', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-shared-settings-'));

    new WindowStateStore(directory).save({ version: 5, x: 120, y: 80, scale: 0.85 });
    expect(new WindowStateStore(directory).load()).toEqual({
      version: 5,
      x: 120,
      y: 80,
      scale: 0.85,
    });

    const providers = new ProviderConfigStore(directory);
    await providers.setOpenAICompatibleBaseUrl('http://127.0.0.1:11434/v1');
    await providers.setConversationSelection({
      providerId: 'openai-compatible',
      modelId: 'fake-local-model',
    });
    const reopenedProviders = new ProviderConfigStore(directory);
    await expect(reopenedProviders.getOpenAICompatibleBaseUrl()).resolves.toBe(
      'http://127.0.0.1:11434/v1',
    );
    await expect(reopenedProviders.getConversationSelection()).resolves.toEqual({
      providerId: 'openai-compatible',
      modelId: 'fake-local-model',
    });

    await new DesktopIntegrationStore(directory).set({
      globalShortcutsEnabled: true,
      mediaControlEnabled: true,
      visibilityShortcut: 'Ctrl+Shift+]',
      stopGenerationShortcut: 'Ctrl+Alt+Backspace',
    });
    await expect(new DesktopIntegrationStore(directory).get()).resolves.toEqual({
      globalShortcutsEnabled: true,
      mediaControlEnabled: true,
      visibilityShortcut: 'Ctrl+Shift+]',
      stopGenerationShortcut: 'Ctrl+Alt+Backspace',
    });

    const profiles = new CharacterProfileStore(directory);
    await profiles.set({
      ...KALTSIT_CHARACTER_PROFILE,
      name: '芙莉莲',
      userDisplayName: '你',
      bio: '精灵魔法使。',
      personaPrompt: '以芙莉莲的身份交流。',
      lore: {
        ...KALTSIT_CHARACTER_PROFILE.lore!,
        canonicalName: '芙莉莲',
        sourceWork: '葬送的芙莉莲',
        identity: '精灵魔法使。',
      },
    });
    const reopenedProfile = await new CharacterProfileStore(directory).get();
    expect(reopenedProfile).toMatchObject({
      name: '芙莉莲',
      lore: { sourceWork: '葬送的芙莉莲' },
    });
    expect(reopenedProfile.memoryNamespace).toMatch(/^character-[a-f0-9]{24}$/u);

    const glossaryEntry = {
      term: '测试梗',
      aliases: ['测试用语'],
      meaning: '只用于本地自动验收。',
      originContext: '来自 fake 测试来源。',
      sources: [
        {
          title: '测试来源',
          url: 'https://example.com/glossary',
          siteName: 'Fake Wiki',
        },
      ],
      lastVerified: 1,
      confidence: 0.8,
    };
    await new WorkGlossaryStore(directory).set('work-test', [glossaryEntry]);
    await expect(new WorkGlossaryStore(directory).get('work-test')).resolves.toMatchObject({
      workId: 'work-test',
      entries: [expect.objectContaining({ term: '测试梗' })],
    });

    const database = new DeskpetDatabase(directory);
    new MemoryService(database, {} as never).setAutomaticMemoryEnabled(true);
    database.close();
    const reopenedDatabase = new DeskpetDatabase(directory);
    expect(new MemoryService(reopenedDatabase, {} as never).isAutomaticMemoryEnabled()).toBe(true);
    reopenedDatabase.close();
  });
});
