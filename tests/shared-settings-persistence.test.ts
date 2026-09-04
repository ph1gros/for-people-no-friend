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
import { SpeechConfigStore } from '../src/main/storage/speech-config-store';
import { createInitialSpeechSettings, DEFAULT_SPEECH_SETTINGS } from '../src/shared/speech-ipc';

describe('shared settings persistence contract', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('migrates legacy default speech speeds to 0.9 and preserves new explicit values', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-speech-settings-'));
    await writeFile(
      path.join(directory, 'speech.v1.json'),
      JSON.stringify({
        version: 1,
        settings: { ...DEFAULT_SPEECH_SETTINGS, speed: 1, volume: 0.45 },
      }),
      'utf8',
    );

    await expect(new SpeechConfigStore(directory).get()).resolves.toMatchObject({
      speed: 0.9,
      volume: 0.45,
    });

    await writeFile(
      path.join(directory, 'speech.v1.json'),
      JSON.stringify({
        version: 2,
        settings: { ...DEFAULT_SPEECH_SETTINGS, speed: 0.95, volume: 0.45 },
      }),
      'utf8',
    );
    await expect(new SpeechConfigStore(directory).get()).resolves.toMatchObject({ speed: 0.9 });

    await new SpeechConfigStore(directory).set({ ...DEFAULT_SPEECH_SETTINGS, speed: 0.95 });
    await expect(new SpeechConfigStore(directory).get()).resolves.toMatchObject({ speed: 0.95 });
  });

  it('migrates the legacy Ireina model id without changing its voice id', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-speech-model-id-'));
    await writeFile(
      path.join(directory, 'speech.v1.json'),
      JSON.stringify({
        version: 3,
        settings: {
          ...createInitialSpeechSettings(true),
          modelId: 'ireina',
          voiceId: 'ireina',
        },
      }),
      'utf8',
    );

    await expect(new SpeechConfigStore(directory, true).get()).resolves.toMatchObject({
      modelId: 'style-bert-vits2',
      voiceId: 'ireina',
    });
  });

  it('removes the obsolete disabled Ireina placeholder when the package has no voice assets', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-speech-no-assets-'));
    await writeFile(
      path.join(directory, 'speech.v1.json'),
      JSON.stringify({
        version: 3,
        settings: createInitialSpeechSettings(true),
      }),
      'utf8',
    );

    await expect(new SpeechConfigStore(directory, false).get()).resolves.toMatchObject({
      providerId: 'disabled',
      modelId: '',
      voiceId: '',
    });
  });

  it('enables a newly downloaded bundled voice without overwriting other speech settings', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-speech-downloaded-assets-'));
    const store = new SpeechConfigStore(directory, false);
    await store.set({
      ...DEFAULT_SPEECH_SETTINGS,
      volume: 0.37,
      inputEnabled: true,
      customWakeWord: '测试唤醒词',
    });

    await expect(store.enableBundledVoiceIfUnconfigured()).resolves.toBe(true);
    await expect(store.get()).resolves.toMatchObject({
      providerId: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:9881/v1',
      modelId: 'style-bert-vits2',
      voiceId: 'ireina',
      volume: 0.37,
      inputEnabled: true,
      customWakeWord: '测试唤醒词',
    });
  });

  it('does not replace an explicitly configured remote voice after a download completes', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-speech-remote-provider-'));
    const store = new SpeechConfigStore(directory, false);
    await store.set({
      ...DEFAULT_SPEECH_SETTINGS,
      providerId: 'openai-compatible',
      baseUrl: 'https://speech.example.com/v1',
      modelId: 'remote-model',
      voiceId: 'remote-voice',
    });

    await expect(store.enableBundledVoiceIfUnconfigured()).resolves.toBe(false);
    await expect(store.get()).resolves.toMatchObject({
      baseUrl: 'https://speech.example.com/v1',
      modelId: 'remote-model',
      voiceId: 'remote-voice',
    });
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
      inputOverlayEnabled: false,
      inputOverlayMouseEnabled: true,
      inputOverlayKeys: ['W', 'A', 'S', 'D'],
      widgetOrder: [],
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
      inputOverlayEnabled: false,
      inputOverlayMouseEnabled: true,
      inputOverlayKeys: ['W', 'A', 'S', 'D'],
      widgetOrder: [],
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
      inputOverlayEnabled: true,
      inputOverlayMouseEnabled: true,
      inputOverlayKeys: ['W', 'A', 'S', 'D', 'Space'],
      widgetOrder: ['media', 'input'],
      visibilityShortcut: 'Ctrl+Shift+]',
      stopGenerationShortcut: 'Ctrl+Alt+Backspace',
    });
    await expect(new DesktopIntegrationStore(directory).get()).resolves.toEqual({
      globalShortcutsEnabled: true,
      mediaControlEnabled: true,
      inputOverlayEnabled: true,
      inputOverlayMouseEnabled: true,
      inputOverlayKeys: ['W', 'A', 'S', 'D', 'Space'],
      widgetOrder: ['media', 'input'],
      visibilityShortcut: 'Ctrl+Shift+]',
      stopGenerationShortcut: 'Ctrl+Alt+Backspace',
    });

    await new SpeechConfigStore(directory).set({
      enabled: true,
      providerId: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:8000/v1',
      modelId: 'fake-tts-model',
      voiceId: 'fake-voice',
      language: 'zh-CN',
      responseFormat: 'wav',
      speed: 1.05,
      volume: 0.42,
      inputMode: 'half',
      wakeWordSource: 'custom',
      customWakeWord: '阿响',
      pushToTalkKey: 'F10',
    });
    await expect(new SpeechConfigStore(directory).get()).resolves.toMatchObject({
      enabled: true,
      modelId: 'fake-tts-model',
      voiceId: 'fake-voice',
      volume: 0.42,
      inputMode: 'half',
      wakeWordSource: 'custom',
      customWakeWord: '阿响',
      pushToTalkKey: 'F10',
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
