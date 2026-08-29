import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ChatEvent, ChatRequest, ModelSelection } from '../src/core/llm/contracts';
import { ConversationRuntime } from '../src/main/conversation/conversation-runtime';
import {
  adaptLegacyCharacterLore,
  createCharacterLoreRevision,
} from '../src/core/character/character-knowledge';
import { KALTSIT_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';
import type { ModelRuntime } from '../src/main/llm/model-runtime';
import type { MemoryService } from '../src/main/memory/memory-service';
import type { WorkGlossaryService } from '../src/main/glossary/work-glossary-service';
import { CharacterProfileStore } from '../src/main/storage/character-profile-store';
import { CharacterKnowledgeStore } from '../src/main/storage/character-knowledge-store';
import { ConversationStore } from '../src/main/storage/conversation-store';
import { DeskpetDatabase } from '../src/main/storage/deskpet-database';
import type { ConversationEvent } from '../src/shared/conversation-ipc';

describe('conversation runtime integration', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it('assembles context, streams visible text and persists the structured reply', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-conversation-test-'));
    let capturedRequest: ChatRequest | undefined;
    const selection: ModelSelection = { providerId: 'openai-compatible', modelId: 'fake-model' };
    const models = {
      getConversationConfiguration: async () => ({ selection }),
      streamConversation: async function* (request: ChatRequest): AsyncIterable<ChatEvent> {
        capturedRequest = request;
        yield { type: 'text-delta', text: '{"text":"流式' };
        yield {
          type: 'text-delta',
          text: '回复","emotion":"happy","action":"wave"}',
        };
        yield { type: 'usage', inputTokens: 12, outputTokens: 8 };
        yield { type: 'finish', reason: 'stop' };
      },
    } as unknown as ModelRuntime;
    const database = new DeskpetDatabase(directory);
    const history = new ConversationStore(database);
    const characterKnowledge = new CharacterKnowledgeStore(database);
    characterKnowledge.replace(
      adaptLegacyCharacterLore(
        KALTSIT_CHARACTER_PROFILE.memoryNamespace,
        KALTSIT_CHARACTER_PROFILE.lore!,
      ),
    );
    const memories = {
      handleExplicitIntent: () => ({ remembered: false, forgotten: 0 }),
      getConversationContext: () => ({
        summary: '用户此前谈过宠物。',
        memories: [
          {
            id: 'memory-cat',
            namespace: 'character-kaltsit',
            type: 'fact',
            normalizedKey: 'pet-cat-name',
            content: '用户的猫叫团子',
            importance: 0.8,
            confidence: 1,
            status: 'active',
            source: 'manual',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
      scheduleMaintenance: () => undefined,
    } as unknown as MemoryService;
    const runtime = new ConversationRuntime(
      models,
      new CharacterProfileStore(directory),
      history,
      memories,
      {
        findMatches: async () => [
          {
            term: '325',
            aliases: ['325大学习'],
            meaning: '明日方舟社区的低分梗。',
            originContext: '来自仙术杯第五届。',
            sources: [{ title: '低分梗', siteName: '测试来源', url: 'https://example.com/325' }],
            lastVerified: 1,
            confidence: 0.9,
          },
        ],
      } as unknown as WorkGlossaryService,
      characterKnowledge,
    );
    const events: ConversationEvent[] = [];
    const completed = new Promise<void>((resolve) => {
      const result = runtime.start(
        { requestId: 'chat_1', message: '你好', availableActions: ['wave'] },
        (event) => {
          events.push(event);
          if (event.type === 'completed' || event.type === 'error') {
            resolve();
          }
        },
      );
      expect(result).toEqual({ ok: true });
    });
    await completed;

    expect(
      events
        .filter((event) => event.type === 'text-delta')
        .map((event) => ('text' in event ? event.text : ''))
        .join(''),
    ).toBe('流式回复');
    expect(capturedRequest?.messages).toEqual([{ role: 'user', content: '你好' }]);
    expect(capturedRequest?.systemPrompt).toContain('wave');
    expect(capturedRequest?.systemPrompt).toContain('用户此前谈过宠物');
    expect(capturedRequest?.systemPrompt).toContain('用户的猫叫团子');
    expect(capturedRequest?.systemPrompt).toContain('玩家社区语境，不是角色世界观事实');
    expect(capturedRequest?.systemPrompt).toContain('当前问题命中的角色资料');
    expect(capturedRequest?.systemPrompt).toContain('日常问候');
    expect(capturedRequest?.systemPrompt).not.toContain('用户已确认的角色资料');
    expect(await history.list(100, 'character-kaltsit')).toEqual([
      expect.objectContaining({ role: 'user', content: '你好', status: 'complete' }),
      expect.objectContaining({
        role: 'assistant',
        content: '流式回复',
        emotion: 'happy',
        action: 'wave',
        inputTokens: 12,
        outputTokens: 8,
      }),
    ]);
    database.close();
  });

  it('generates a bounded contextual opening line without adding synthetic history', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-opening-line-test-'));
    let capturedRequest: ChatRequest | undefined;
    let invocations = 0;
    const selection: ModelSelection = { providerId: 'openai-compatible', modelId: 'fake-model' };
    const models = {
      getConversationConfiguration: async () => ({ selection }),
      streamConversation: async function* (request: ChatRequest): AsyncIterable<ChatEvent> {
        invocations += 1;
        capturedRequest = request;
        yield {
          type: 'text-delta',
          text: '{"text":"（轻轻点头）上次说到团子的近况，今天它还好吗？","emotion":"happy","action":null}',
        };
        yield { type: 'finish', reason: 'stop' };
      },
    } as unknown as ModelRuntime;
    const database = new DeskpetDatabase(directory);
    const history = new ConversationStore(database);
    await history.append(
      {
        id: 'opening-user',
        role: 'user',
        content: '团子今天终于肯好好吃饭了。',
        createdAt: 1,
        status: 'complete',
      },
      KALTSIT_CHARACTER_PROFILE.memoryNamespace,
    );
    await history.append(
      {
        id: 'opening-assistant',
        role: 'assistant',
        content: '这至少说明情况正在改善，继续观察。',
        createdAt: 2,
        status: 'complete',
      },
      KALTSIT_CHARACTER_PROFILE.memoryNamespace,
    );
    const memories = {
      getConversationContext: async () => ({
        summary: '用户最近在照顾宠物团子。',
        memories: [],
      }),
    } as unknown as MemoryService;
    const runtime = new ConversationRuntime(
      models,
      new CharacterProfileStore(directory),
      history,
      memories,
    );

    const result = await runtime.generateContextualOpeningLine();

    expect(result).toEqual({ line: '上次说到团子的近况，今天它还好吗？', emotion: 'happy' });
    expect(capturedRequest?.maxOutputTokens).toBe(512);
    expect(capturedRequest?.timeoutMs).toBe(15_000);
    expect(capturedRequest?.messages).toEqual([
      { role: 'user', content: '团子今天终于肯好好吃饭了。' },
      { role: 'assistant', content: '这至少说明情况正在改善，继续观察。' },
      {
        role: 'user',
        content: '[应用启动事件] 请自然延续此前相处，但不要假装用户刚刚说了新内容。',
      },
    ]);
    expect(capturedRequest?.systemPrompt).toContain('用户最近在照顾宠物团子');
    expect(capturedRequest?.systemPrompt).toContain('不要逐字复述历史');
    expect(await history.list(100, KALTSIT_CHARACTER_PROFILE.memoryNamespace)).toHaveLength(2);
    expect(await runtime.generateContextualOpeningLine()).toBeUndefined();
    expect(invocations).toBe(1);
    database.close();
  });

  it('rejects a contextual opening line when the model reports token truncation', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-opening-line-truncated-test-'));
    const models = {
      getConversationConfiguration: async () => ({
        selection: { providerId: 'openai-compatible', modelId: 'fake-model' },
      }),
      streamConversation: async function* (): AsyncIterable<ChatEvent> {
        yield { type: 'text-delta', text: '上次说到一半，所以这次我想继续，' };
        yield { type: 'finish', reason: 'length' };
      },
    } as unknown as ModelRuntime;
    const history = new ConversationStore(directory);
    await history.append(
      {
        id: 'truncated-opening-user',
        role: 'user',
        content: '我们下次继续聊。',
        createdAt: 1,
        status: 'complete',
      },
      KALTSIT_CHARACTER_PROFILE.memoryNamespace,
    );
    const runtime = new ConversationRuntime(models, new CharacterProfileStore(directory), history);

    expect(await runtime.generateContextualOpeningLine()).toBeUndefined();
    history.close();
  });

  it('does not invoke the model for a contextual opening line without history', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-empty-opening-line-test-'));
    let invoked = false;
    const models = {
      getConversationConfiguration: async () => ({
        selection: { providerId: 'openai-compatible', modelId: 'fake-model' },
      }),
      streamConversation: async function* (): AsyncIterable<ChatEvent> {
        invoked = true;
        yield { type: 'finish', reason: 'stop' };
      },
    } as unknown as ModelRuntime;
    const history = new ConversationStore(directory);
    const runtime = new ConversationRuntime(models, new CharacterProfileStore(directory), history);

    expect(await runtime.generateContextualOpeningLine()).toBeUndefined();
    expect(invoked).toBe(false);
    history.close();
  });

  it('cancels the active generation through the bounded Main shortcut action', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-conversation-cancel-all-'));
    const models = {
      getConversationConfiguration: async () => ({
        selection: { providerId: 'openai-compatible', modelId: 'fake-model' },
      }),
      streamConversation: async function* (
        _request: ChatRequest,
        _selection: ModelSelection,
        signal?: AbortSignal,
      ): AsyncIterable<ChatEvent> {
        await new Promise<void>((_resolve, reject) => {
          const abort = (): void => reject(new DOMException('Aborted', 'AbortError'));
          if (signal?.aborted) abort();
          else signal?.addEventListener('abort', abort, { once: true });
        });
        yield { type: 'finish', reason: 'stop' };
      },
    } as unknown as ModelRuntime;
    const database = new DeskpetDatabase(directory);
    const runtime = new ConversationRuntime(
      models,
      new CharacterProfileStore(directory),
      new ConversationStore(database),
    );
    const cancelled = new Promise<void>((resolve) => {
      runtime.start(
        { requestId: 'chat_shortcut_stop', message: '请生成很长的回复', availableActions: [] },
        (event) => {
          if (event.type === 'cancelled') resolve();
        },
      );
    });

    expect(runtime.cancelAll()).toBe(1);
    expect(runtime.cancelAll()).toBe(0);
    await cancelled;
    database.close();
  });

  it('reports missing model configuration without invoking a provider', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-conversation-test-'));
    const models = {
      getConversationConfiguration: async () => ({}),
    } as unknown as ModelRuntime;
    const history = new ConversationStore(directory);
    const runtime = new ConversationRuntime(models, new CharacterProfileStore(directory), history);
    const event = await new Promise<ConversationEvent>((resolve) => {
      runtime.start({ requestId: 'chat_2', message: '你好', availableActions: [] }, (next) =>
        resolve(next),
      );
    });
    expect(event).toMatchObject({
      requestId: 'chat_2',
      type: 'error',
      error: { code: 'configuration' },
    });
    history.close();
  });

  it('persists the current explicit mood when a model returns a conflicting emotion', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-conversation-test-'));
    const selection: ModelSelection = { providerId: 'openai-compatible', modelId: 'fake-model' };
    const models = {
      getConversationConfiguration: async () => ({ selection }),
      streamConversation: async function* (): AsyncIterable<ChatEvent> {
        yield {
          type: 'text-delta',
          text: '{"text":"请注意措辞。","emotion":"neutral","action":null}',
        };
        yield { type: 'finish', reason: 'stop' };
      },
    } as unknown as ModelRuntime;
    const history = new ConversationStore(directory);
    const runtime = new ConversationRuntime(models, new CharacterProfileStore(directory), history);
    let completedMessage:
      Extract<ConversationEvent, { type: 'completed' }>['assistantMessage'] | undefined;

    await new Promise<void>((resolve) => {
      runtime.start(
        { requestId: 'chat_mood', message: '你就是个大傻逼', availableActions: [] },
        (event) => {
          if (event.type === 'completed') {
            completedMessage = event.assistantMessage;
            resolve();
          }
          if (event.type === 'error') resolve();
        },
      );
    });

    expect(completedMessage).toMatchObject({ content: '请注意措辞。', emotion: 'angry' });
    expect(await history.list(100, 'character-kaltsit')).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'assistant', emotion: 'angry' })]),
    );
    history.close();
  });

  it('falls back to the validated legacy card when the optional knowledge store fails', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-conversation-test-'));
    let capturedRequest: ChatRequest | undefined;
    const selection: ModelSelection = { providerId: 'openai-compatible', modelId: 'fake-model' };
    const models = {
      getConversationConfiguration: async () => ({ selection }),
      streamConversation: async function* (request: ChatRequest): AsyncIterable<ChatEvent> {
        capturedRequest = request;
        yield { type: 'text-delta', text: '{"text":"我在。","emotion":"neutral","action":null}' };
        yield { type: 'finish', reason: 'stop' };
      },
    } as unknown as ModelRuntime;
    const history = new ConversationStore(directory);
    const runtime = new ConversationRuntime(
      models,
      new CharacterProfileStore(directory),
      history,
      undefined,
      undefined,
      {
        get: () => {
          throw new Error('fake damaged optional knowledge store');
        },
      } as unknown as CharacterKnowledgeStore,
    );

    await new Promise<void>((resolve) => {
      runtime.start(
        { requestId: 'chat_fallback', message: '你好', availableActions: [] },
        (event) => {
          if (event.type === 'completed' || event.type === 'error') resolve();
        },
      );
    });

    expect(capturedRequest?.systemPrompt).toContain('当前问题命中的角色资料');
    expect(capturedRequest?.systemPrompt).toContain('日常问候');
    history.close();
  });

  it('continues basic chat when the optional work glossary fails', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-conversation-test-'));
    let capturedRequest: ChatRequest | undefined;
    const selection: ModelSelection = { providerId: 'openai-compatible', modelId: 'fake-model' };
    const models = {
      getConversationConfiguration: async () => ({ selection }),
      streamConversation: async function* (request: ChatRequest): AsyncIterable<ChatEvent> {
        capturedRequest = request;
        yield {
          type: 'text-delta',
          text: '{"text":"仍可聊天。","emotion":"neutral","action":null}',
        };
        yield { type: 'finish', reason: 'stop' };
      },
    } as unknown as ModelRuntime;
    const history = new ConversationStore(directory);
    const runtime = new ConversationRuntime(
      models,
      new CharacterProfileStore(directory),
      history,
      undefined,
      {
        findMatches: async () => Promise.reject(new Error('fake glossary failure')),
      } as unknown as WorkGlossaryService,
    );
    const events: ConversationEvent[] = [];
    await new Promise<void>((resolve) => {
      runtime.start(
        { requestId: 'chat_glossary_fallback', message: '325是什么？', availableActions: [] },
        (event) => {
          events.push(event);
          if (event.type === 'completed' || event.type === 'error') resolve();
        },
      );
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'completed',
          assistantMessage: expect.objectContaining({ content: '仍可聊天。' }),
        }),
      ]),
    );
    expect(capturedRequest?.systemPrompt).not.toContain('玩家社区语境');
    history.close();
  });

  it('stores confirmed profile lore with a matching revision', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-conversation-test-'));
    const database = new DeskpetDatabase(directory);
    const profiles = new CharacterProfileStore(directory);
    const knowledge = new CharacterKnowledgeStore(database);
    const runtime = new ConversationRuntime(
      {} as ModelRuntime,
      profiles,
      new ConversationStore(database),
      undefined,
      undefined,
      knowledge,
    );
    const updated = {
      ...KALTSIT_CHARACTER_PROFILE,
      lore: {
        ...KALTSIT_CHARACTER_PROFILE.lore!,
        identity: '用户确认后的新身份资料。',
      },
    };

    await runtime.setCharacterProfile(updated);

    const storedProfile = await profiles.get();
    expect(storedProfile).toMatchObject({ lore: { identity: '用户确认后的新身份资料。' } });
    expect(knowledge.get('character-kaltsit')).toMatchObject({
      profileRevision: createCharacterLoreRevision(storedProfile.lore!),
      records: expect.arrayContaining([
        expect.objectContaining({ kind: 'identity', content: '用户确认后的新身份资料。' }),
      ]),
    });
    database.close();
  });

  it('moves a different character to an isolated history and memory namespace', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-character-switch-'));
    const database = new DeskpetDatabase(directory);
    const profiles = new CharacterProfileStore(directory);
    const history = new ConversationStore(database);
    const knowledge = new CharacterKnowledgeStore(database);
    await history.append(
      {
        id: 'keqing-era-message',
        role: 'assistant',
        content: '我是刻晴，璃月七星之一。',
        createdAt: 1,
        status: 'complete',
      },
      'character-kaltsit',
    );
    const runtime = new ConversationRuntime(
      {} as ModelRuntime,
      profiles,
      history,
      undefined,
      undefined,
      knowledge,
    );
    await runtime.setCharacterProfile({
      ...KALTSIT_CHARACTER_PROFILE,
      name: '芙宁娜',
      userDisplayName: '旅行者',
      bio: '枫丹的重要人物。',
      personaPrompt: '以芙宁娜的身份交流。',
      lore: {
        ...KALTSIT_CHARACTER_PROFILE.lore!,
        canonicalName: '芙宁娜',
        sourceWork: '原神',
        identity: '枫丹的重要人物。',
      },
    });

    const stored = await profiles.get();
    expect(stored.memoryNamespace).toMatch(/^character-[a-f0-9]{24}$/u);
    expect(stored.memoryNamespace).not.toBe('character-kaltsit');
    expect(await runtime.listHistory()).toEqual([]);
    expect(await history.list(100, 'character-kaltsit')).toEqual([
      expect.objectContaining({ id: 'keqing-era-message' }),
    ]);
    expect(knowledge.get(stored.memoryNamespace)).toMatchObject({
      characterNamespace: stored.memoryNamespace,
    });
    database.close();
  });

  it('restores each persona history when switching away and back again', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-character-roundtrip-'));
    const database = new DeskpetDatabase(directory);
    const profiles = new CharacterProfileStore(directory);
    const history = new ConversationStore(database);
    const runtime = new ConversationRuntime({} as ModelRuntime, profiles, history);
    const profileFor = (name: string) => ({
      ...KALTSIT_CHARACTER_PROFILE,
      name,
      userDisplayName: '旅行者',
      bio: `${name}的角色身份。`,
      personaPrompt: `以${name}的身份交流。`,
      lore: {
        ...KALTSIT_CHARACTER_PROFILE.lore!,
        canonicalName: name,
        sourceWork: '原神',
        identity: `${name}的角色身份。`,
      },
    });

    await runtime.setCharacterProfile(profileFor('芙宁娜'));
    const furinaNamespace = (await profiles.get()).memoryNamespace;
    await history.append(
      {
        id: 'furina-message',
        role: 'assistant',
        content: '这里是枫丹。',
        createdAt: 1,
        status: 'complete',
      },
      furinaNamespace,
    );

    await runtime.setCharacterProfile(profileFor('刻晴'));
    const keqingNamespace = (await profiles.get()).memoryNamespace;
    expect(keqingNamespace).not.toBe(furinaNamespace);
    expect(await runtime.listHistory()).toEqual([]);
    await history.append(
      {
        id: 'keqing-message',
        role: 'assistant',
        content: '这里是璃月。',
        createdAt: 2,
        status: 'complete',
      },
      keqingNamespace,
    );

    await runtime.setCharacterProfile(profileFor('芙宁娜'));
    expect((await profiles.get()).memoryNamespace).toBe(furinaNamespace);
    expect(await runtime.listHistory()).toEqual([
      expect.objectContaining({ id: 'furina-message', content: '这里是枫丹。' }),
    ]);
    expect(await history.list(100, keqingNamespace)).toEqual([
      expect.objectContaining({ id: 'keqing-message', content: '这里是璃月。' }),
    ]);
    database.close();
  });

  it('rejects stale stored lore after the profile changes', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-conversation-test-'));
    let capturedRequest: ChatRequest | undefined;
    const selection: ModelSelection = { providerId: 'openai-compatible', modelId: 'fake-model' };
    const models = {
      getConversationConfiguration: async () => ({ selection }),
      streamConversation: async function* (request: ChatRequest): AsyncIterable<ChatEvent> {
        capturedRequest = request;
        yield { type: 'text-delta', text: '{"text":"新资料。","emotion":"neutral","action":null}' };
        yield { type: 'finish', reason: 'stop' };
      },
    } as unknown as ModelRuntime;
    const profiles = new CharacterProfileStore(directory);
    await profiles.set({
      ...KALTSIT_CHARACTER_PROFILE,
      lore: { ...KALTSIT_CHARACTER_PROFILE.lore!, identity: '只存在于当前角色卡的新身份。' },
    });
    const history = new ConversationStore(directory);
    const runtime = new ConversationRuntime(models, profiles, history, undefined, undefined, {
      get: () =>
        adaptLegacyCharacterLore(
          KALTSIT_CHARACTER_PROFILE.memoryNamespace,
          KALTSIT_CHARACTER_PROFILE.lore!,
        ),
    } as unknown as CharacterKnowledgeStore);

    await new Promise<void>((resolve) => {
      runtime.start(
        { requestId: 'chat_stale', message: '你是谁？', availableActions: [] },
        (event) => {
          if (event.type === 'completed' || event.type === 'error') resolve();
        },
      );
    });

    expect(capturedRequest?.systemPrompt).toContain('只存在于当前角色卡的新身份');
    expect(capturedRequest?.systemPrompt).not.toContain('罗德岛高级管理人员与医疗项目负责人');
    history.close();
  });
});
