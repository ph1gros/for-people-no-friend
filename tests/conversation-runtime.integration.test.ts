import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ChatEvent, ChatRequest, ModelSelection } from '../src/core/llm/contracts';
import { IRENA_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';
import { ConversationRuntime } from '../src/main/conversation/conversation-runtime';
import type { ModelRuntime } from '../src/main/llm/model-runtime';
import type { MemoryService } from '../src/main/memory/memory-service';
import type { WorkGlossaryService } from '../src/main/glossary/work-glossary-service';
import { CharacterProfileStore } from '../src/main/storage/character-profile-store';
import { ConversationStore } from '../src/main/storage/conversation-store';
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
    const history = new ConversationStore(directory);
    const memories = {
      handleExplicitIntent: () => ({ remembered: false, forgotten: 0 }),
      getConversationContext: () => ({
        summary: '用户此前谈过宠物。',
        memories: [
          {
            id: 'memory-cat',
            namespace: 'default-character',
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

    expect(events.find((event) => event.type === 'error')).toBeUndefined();
    expect(events.filter((event) => event.type === 'text-delta')).toEqual([
      { requestId: 'chat_1', type: 'text-delta', text: '流式' },
      { requestId: 'chat_1', type: 'text-delta', text: '回复' },
    ]);
    expect(capturedRequest?.messages).toEqual([{ role: 'user', content: '你好' }]);
    expect(capturedRequest?.systemPrompt).toContain('wave');
    expect(capturedRequest?.systemPrompt).toContain('用户此前谈过宠物');
    expect(capturedRequest?.systemPrompt).toContain('用户的猫叫团子');
    expect(capturedRequest?.systemPrompt).toContain('当前作品社区词库命中');
    expect(await history.list(100, 'character-irena')).toEqual([
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
    history.close();
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

  it('isolates and restores generated WebP persona history', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-webp-persona-history-'));
    const profiles = new CharacterProfileStore(directory);
    const history = new ConversationStore(directory);
    const runtime = new ConversationRuntime({} as ModelRuntime, profiles, history);
    const profileFor = (name: string) => ({
      ...IRENA_CHARACTER_PROFILE,
      name,
      bio: `${name}的角色身份。`,
      personaPrompt: `以${name}的身份交流。`,
      lore: {
        ...IRENA_CHARACTER_PROFILE.lore!,
        canonicalName: name,
        sourceWork: '葬送的芙莉莲',
        identity: `${name}的角色身份。`,
      },
    });

    await runtime.setCharacterProfile(profileFor('芙莉莲'));
    const frierenNamespace = (await profiles.get()).memoryNamespace;
    await history.append(
      {
        id: 'frieren-message',
        role: 'assistant',
        content: '这是芙莉莲的历史。',
        createdAt: 1,
        status: 'complete',
      },
      frierenNamespace,
    );

    await runtime.setCharacterProfile(profileFor('菲伦'));
    const fernNamespace = (await profiles.get()).memoryNamespace;
    expect(fernNamespace).not.toBe(frierenNamespace);
    expect(await runtime.listHistory()).toEqual([]);
    await history.append(
      {
        id: 'fern-message',
        role: 'assistant',
        content: '这是菲伦的历史。',
        createdAt: 2,
        status: 'complete',
      },
      fernNamespace,
    );

    await runtime.setCharacterProfile(profileFor('芙莉莲'));
    expect((await profiles.get()).memoryNamespace).toBe(frierenNamespace);
    expect(await runtime.listHistory()).toEqual([
      expect.objectContaining({ id: 'frieren-message', content: '这是芙莉莲的历史。' }),
    ]);
    expect(await history.list(100, fernNamespace)).toEqual([
      expect.objectContaining({ id: 'fern-message', content: '这是菲伦的历史。' }),
    ]);
    history.close();
  });
});
