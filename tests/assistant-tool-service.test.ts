import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ChatEvent, ModelSelection } from '../src/core/llm/contracts';
import { AssistantToolService } from '../src/main/assistant/assistant-tool-service';
import type { ModelRuntime } from '../src/main/llm/model-runtime';
import { AssistantWorkspaceStore } from '../src/main/storage/assistant-workspace-store';

const temporaryDirectories: string[] = [];
const selection: ModelSelection = { providerId: 'openai-compatible', modelId: 'fake' };

const createModels = (responses: string[]): ModelRuntime => {
  let index = 0;
  return {
    streamConversation: async function* (): AsyncIterable<ChatEvent> {
      const response = responses[index++];
      if (!response) throw new Error('Unexpected model call.');
      yield { type: 'text-delta', text: response };
      yield { type: 'usage', inputTokens: 3, outputTokens: 2 };
      yield { type: 'finish', reason: 'stop' };
    },
  } as unknown as ModelRuntime;
};

const createWorkspace = async (): Promise<{
  directory: string;
  store: AssistantWorkspaceStore;
}> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-assistant-tools-'));
  temporaryDirectories.push(directory);
  const store = new AssistantWorkspaceStore(directory);
  await store.setRoot(directory);
  return { directory, store };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('controlled assistant tools', () => {
  it('imports explicit dropped files without overwriting or calling a model', async () => {
    const { directory, store } = await createWorkspace();
    await writeFile(path.join(directory, 'note.txt'), 'old');
    const service = new AssistantToolService(createModels([]), store);

    const result = await service.importDroppedFiles({
      assistantMode: true,
      files: [
        { name: 'note.txt', bytes: new TextEncoder().encode('new') },
        { name: 'empty.txt', bytes: new Uint8Array() },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.imported).toEqual(['note (2).txt', 'empty.txt']);
    expect(await readFile(path.join(directory, 'note.txt'), 'utf8')).toBe('old');
    expect(await readFile(path.join(directory, 'note (2).txt'), 'utf8')).toBe('new');
    expect(await readFile(path.join(directory, 'empty.txt'))).toHaveLength(0);
  });

  it('rejects dropped files when work mode is off or the name is unsafe', async () => {
    const { directory, store } = await createWorkspace();
    const service = new AssistantToolService(createModels([]), store);
    const bytes = new TextEncoder().encode('test');

    expect(
      await service.importDroppedFiles({
        assistantMode: false,
        files: [{ name: 'note.txt', bytes }],
      }),
    ).toMatchObject({ ok: false, imported: [] });
    expect(
      await service.importDroppedFiles({
        assistantMode: true,
        files: [
          { name: 'would-have-been-written.txt', bytes },
          { name: '../escape.txt', bytes },
        ],
      }),
    ).toMatchObject({ ok: false, imported: [] });
    await expect(readFile(path.join(directory, 'escape.txt'))).rejects.toThrow();
    await expect(readFile(path.join(directory, 'would-have-been-written.txt'))).rejects.toThrow();
  });

  it('reads only from the selected workspace and returns a grounded final reply', async () => {
    const { directory, store } = await createWorkspace();
    await writeFile(path.join(directory, 'note.txt'), '安全测试内容');
    const service = new AssistantToolService(
      createModels([
        JSON.stringify({ kind: 'tool', tool: 'read_file', input: { path: 'note.txt' } }),
        JSON.stringify({
          kind: 'final',
          text: '文件内容是：安全测试内容',
          emotion: 'neutral',
          action: null,
        }),
      ]),
      store,
    );

    const result = await service.run(
      {
        requestId: 'chat_read',
        systemPrompt: '测试',
        messages: [{ role: 'user', content: '读取 note.txt' }],
        selection,
        allowedActions: [],
      },
      { onStatus: () => undefined, requestApproval: async () => false },
    );

    expect(result.reply.text).toBe('文件内容是：安全测试内容');
    expect(result.inputTokens).toBe(6);
  });

  it('requires approval before an atomic workspace write', async () => {
    const { directory, store } = await createWorkspace();
    await writeFile(path.join(directory, 'code.ts'), 'export const value = 1;\n');
    const service = new AssistantToolService(
      createModels([
        JSON.stringify({ kind: 'tool', tool: 'read_file', input: { path: 'code.ts' } }),
        JSON.stringify({
          kind: 'tool',
          tool: 'write_file',
          input: { path: 'code.ts', content: 'export const value = 2;\n' },
        }),
        JSON.stringify({
          kind: 'final',
          text: '已经修改。',
          emotion: 'happy',
          action: null,
        }),
      ]),
      store,
    );
    const approvals: string[] = [];

    const result = await service.run(
      {
        requestId: 'chat_write',
        systemPrompt: '测试',
        messages: [{ role: 'user', content: '把 value 改成 2' }],
        selection,
        allowedActions: [],
      },
      {
        onStatus: () => undefined,
        requestApproval: async ({ description }) => {
          approvals.push(description);
          return true;
        },
      },
    );

    expect(approvals).toEqual(['将写入工作区中的 code.ts']);
    expect(await readFile(path.join(directory, 'code.ts'), 'utf8')).toBe(
      'export const value = 2;\n',
    );
    expect(result.reply.text).toBe('已经修改。');
  });

  it('searches the web through a bounded fake HTTPS response without credentials', async () => {
    const { store } = await createWorkspace();
    const requests: string[] = [];
    const service = new AssistantToolService(
      createModels([
        JSON.stringify({ kind: 'tool', tool: 'web_search', input: { query: '测试资料' } }),
        JSON.stringify({
          kind: 'final',
          text: '找到了测试资料。',
          emotion: 'neutral',
          action: null,
        }),
      ]),
      store,
      async (input) => {
        requests.push(input.toString());
        return new Response(
          '<rss><channel><item><title>测试结果</title><link>https://example.com/a</link><description>公开摘要</description></item></channel></rss>',
          { status: 200, headers: { 'content-type': 'application/rss+xml' } },
        );
      },
    );

    const result = await service.run(
      {
        requestId: 'chat_web',
        systemPrompt: '测试',
        messages: [{ role: 'user', content: '查找测试资料' }],
        selection,
        allowedActions: [],
      },
      { onStatus: () => undefined, requestApproval: async () => false },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain('https://www.bing.com/search');
    expect(result.reply.text).toBe('找到了测试资料。');
  });
});
