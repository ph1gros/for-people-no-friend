import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ChatEvent, ChatRequest, ModelSelection, ModelTask } from '../src/core/llm/contracts';
import { formatExplicitMemoryResult, MemoryService } from '../src/main/memory/memory-service';
import { DeskpetDatabase } from '../src/main/storage/deskpet-database';
import type { ConversationMessage } from '../src/shared/conversation-ipc';

describe('M5 memory service integration', () => {
  let directory: string | undefined;
  let database: DeskpetDatabase | undefined;

  afterEach(async () => {
    database?.close();
    database = undefined;
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it('tells the reply model to acknowledge an explicit update naturally', () => {
    const context = formatExplicitMemoryResult({
      remembered: true,
      forgotten: 0,
    });
    expect(context).toContain('同类旧记忆也已按用户的新说法更新');
    expect(context).toContain('不要解释记忆流程');
    expect(context).toContain('不要重复追问');
  });

  it('handles explicit remember and forget without a model call', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-memory-service-'));
    database = new DeskpetDatabase(directory);
    let modelCalled = false;
    const models = {
      streamMemoryTask: async function* (): AsyncIterable<ChatEvent> {
        modelCalled = true;
        yield { type: 'finish', reason: 'unexpected' };
      },
    };
    const service = new MemoryService(database, models);
    expect(
      service.handleExplicitIntent('default-character', {
        id: 'user-1',
        role: 'user',
        content: '记住：我喜欢蓝色。',
        createdAt: 1,
        status: 'complete',
      }),
    ).toEqual({ remembered: true, forgotten: 0 });
    expect(service.list('default-character')).toEqual([
      expect.objectContaining({ content: '我喜欢蓝色', source: 'manual' }),
    ]);
    expect(
      service.handleExplicitIntent('default-character', {
        id: 'user-2',
        role: 'user',
        content: '忘掉：蓝色',
        createdAt: 2,
        status: 'complete',
      }),
    ).toEqual({ remembered: false, forgotten: 1 });
    expect(service.list('default-character')).toEqual([]);
    expect(modelCalled).toBe(false);
  });

  it('lets an explicit remember request immediately replace the old preference', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-memory-explicit-conflict-'));
    database = new DeskpetDatabase(directory);
    const service = new MemoryService(database, {
      streamMemoryTask: async function* (): AsyncIterable<ChatEvent> {
        yield { type: 'finish', reason: 'unexpected' };
      },
    });
    const namespace = 'default-character';

    expect(
      service.handleExplicitIntent(namespace, {
        id: 'preference-old',
        role: 'user',
        content: '记住：我喜欢喝温水，不喜欢冰水。',
        createdAt: 1,
        status: 'complete',
      }),
    ).toEqual({ remembered: true, forgotten: 0 });
    expect(
      service.handleExplicitIntent(namespace, {
        id: 'preference-new',
        role: 'user',
        content: '记住：我不再喜欢喝温水，不喜欢冰水。',
        createdAt: 2,
        status: 'complete',
      }),
    ).toEqual({ remembered: true, forgotten: 0 });

    expect(service.list(namespace)).toEqual([
      expect.objectContaining({
        content: '我不再喜欢喝温水，不喜欢冰水',
        source: 'manual',
        status: 'active',
      }),
    ]);
    expect(service.listCandidates(namespace)).toEqual([]);
  });

  it('summarizes only old complete turns and extracts a bounded automatic batch', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-memory-maintenance-'));
    database = new DeskpetDatabase(directory);
    const calls: { task: string; request: ChatRequest }[] = [];
    const models = {
      streamMemoryTask: async function* (
        task: Extract<ModelTask, 'memoryExtraction' | 'summarization'>,
        request: ChatRequest,
      ): AsyncIterable<ChatEvent> {
        calls.push({ task, request });
        if (task === 'summarization') {
          yield { type: 'text-delta', text: '{"summary":"用户早些时候讨论过学习计划。"}' };
        } else {
          yield {
            type: 'text-delta',
            text: JSON.stringify([
              {
                type: 'preference',
                normalizedKey: 'color',
                content: '用户喜欢蓝色',
                importance: 0.8,
                confidence: 0.9,
                sourceMessageId: 'message-28',
              },
              {
                type: 'fact',
                normalizedKey: 'assistant-claim',
                content: '助手声称用户喜欢红色',
                importance: 0.8,
                confidence: 0.9,
                sourceMessageId: 'message-29',
              },
              {
                type: 'fact',
                normalizedKey: 'invented-source',
                content: '没有真实来源的事实',
                importance: 0.8,
                confidence: 0.9,
                sourceMessageId: 'invented-message',
              },
            ]),
          };
        }
        yield { type: 'finish', reason: 'stop' };
      },
    };
    const service = new MemoryService(database, models);
    service.setAutomaticMemoryEnabled(true);
    const messages: ConversationMessage[] = Array.from({ length: 30 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: index === 28 ? '我喜欢蓝色' : `第 ${index + 1} 条对话内容`,
      createdAt: index,
      status: 'complete',
    }));
    const selection: ModelSelection = { providerId: 'openai-compatible', modelId: 'fake' };
    service.scheduleMaintenance('default-character', selection, messages);
    await service.waitForMaintenance();

    expect(calls.map((call) => call.task)).toEqual(['summarization', 'memoryExtraction']);
    expect(calls[0]?.request.messages).toHaveLength(10);
    expect(calls[0]?.request.messages.at(-1)?.content).toContain('10');
    expect(database.getSummary()).toMatchObject({
      summary: '用户早些时候讨论过学习计划。',
      coveredUntilMessageId: 'message-9',
    });
    expect(service.list('default-character')).toEqual([]);
    expect(service.listCandidates('default-character')).toEqual([
      expect.objectContaining({
        content: '用户喜欢蓝色',
        status: 'pending',
        reviewReasons: expect.arrayContaining(['profile_claim']),
        evidence: [expect.objectContaining({ sourceMessageId: 'message-28' })],
      }),
    ]);
    expect(
      await service.getConversationContext('default-character', '你记得我喜欢什么颜色吗'),
    ).toEqual(
      expect.objectContaining({
        summary: '用户早些时候讨论过学习计划。',
        memories: [],
      }),
    );
    const candidate = service.listCandidates('default-character')[0];
    expect(service.confirmCandidate('default-character', candidate?.id ?? '')).toEqual(
      expect.objectContaining({ content: '用户喜欢蓝色', source: 'automatic' }),
    );
    expect(
      (await service.getConversationContext('default-character', '你记得我喜欢什么颜色吗'))
        .memories,
    ).toEqual([expect.objectContaining({ content: '用户喜欢蓝色' })]);
  });
});
