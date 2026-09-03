import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ChatEvent, ModelSelection } from '../src/core/llm/contracts';
import { AssistantToolService } from '../src/main/assistant/assistant-tool-service';
import type { ModelRuntime } from '../src/main/llm/model-runtime';
import { AssistantWorkspaceStore } from '../src/main/storage/assistant-workspace-store';

const temporaryDirectories: string[] = [];
const selection: ModelSelection = { providerId: 'openai-compatible', modelId: 'fake' };

const createModels = (responses: string[], capturedSystemPrompts: string[] = []): ModelRuntime => {
  let index = 0;
  return {
    streamConversation: async function* (request): AsyncIterable<ChatEvent> {
      capturedSystemPrompts.push(request.systemPrompt);
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
  const canonicalDirectory = await realpath(directory);
  const store = new AssistantWorkspaceStore(canonicalDirectory);
  await store.setRoot(canonicalDirectory);
  return { directory: canonicalDirectory, store };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('controlled assistant tools', () => {
  it('reinforces the active character card for final work-mode replies', async () => {
    const { store } = await createWorkspace();
    const capturedSystemPrompts: string[] = [];
    const service = new AssistantToolService(
      createModels(
        [
          JSON.stringify({
            kind: 'final',
            text: '已经整理完成。',
            emotion: 'neutral',
            action: null,
          }),
        ],
        capturedSystemPrompts,
      ),
      store,
    );
    const characterPrompt = [
      '【稳定角色核心】',
      '你是“测试角色”。',
      '用户称呼：博士',
      '人格规则：冷静、克制，使用简短陈述句。',
    ].join('\n');

    await service.run(
      {
        requestId: 'chat_persona',
        systemPrompt: characterPrompt,
        messages: [{ role: 'user', content: '帮我整理资料' }],
        selection,
        allowedActions: [],
      },
      { onStatus: () => undefined, requestApproval: async () => false },
    );

    expect(capturedSystemPrompts).toHaveLength(1);
    expect(capturedSystemPrompts[0]).toContain(characterPrompt);
    expect(capturedSystemPrompts[0]).toContain('工作模式不会改变当前角色身份');
    expect(capturedSystemPrompts[0]).toContain(
      'final.text 必须继续遵守【稳定角色核心】和【回复边界】',
    );
    expect(capturedSystemPrompts[0]).toContain('不得退回通用助手或客服口吻');
  });

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

  it('reads and writes an external file only after confirming each operation', async () => {
    const { store } = await createWorkspace();
    const externalDirectory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-external-file-'));
    temporaryDirectories.push(externalDirectory);
    const externalFile = path.join(externalDirectory, 'note.txt');
    await writeFile(externalFile, 'before');
    const canonicalExternalFile = await realpath(externalFile);
    const service = new AssistantToolService(
      createModels([
        JSON.stringify({ kind: 'tool', tool: 'read_file', input: { path: externalFile } }),
        JSON.stringify({
          kind: 'tool',
          tool: 'write_file',
          input: { path: externalFile, content: 'after' },
        }),
        JSON.stringify({ kind: 'final', text: '外部文件已修改。', emotion: 'neutral' }),
      ]),
      store,
    );
    const approvals: Array<{ title: string; description: string }> = [];

    await service.run(
      {
        requestId: 'chat_external_read_write',
        systemPrompt: '测试',
        messages: [{ role: 'user', content: `读取并修改 ${externalFile}` }],
        selection,
        allowedActions: [],
      },
      {
        onStatus: () => undefined,
        requestApproval: async ({ title, description }) => {
          approvals.push({ title, description });
          return true;
        },
      },
    );

    expect(approvals.map(({ title }) => title)).toEqual([
      '允许助手读取文件工作区外目标？',
      '允许助手写入文件工作区外目标？',
    ]);
    expect(approvals.every(({ description }) => description.includes(canonicalExternalFile))).toBe(
      true,
    );
    expect(await readFile(externalFile, 'utf8')).toBe('after');
  });

  it('does not write an external file when confirmation is denied', async () => {
    const { store } = await createWorkspace();
    const externalDirectory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-external-denied-'));
    temporaryDirectories.push(externalDirectory);
    const externalFile = path.join(externalDirectory, 'note.txt');
    await writeFile(externalFile, 'unchanged');
    const service = new AssistantToolService(
      createModels([
        JSON.stringify({
          kind: 'tool',
          tool: 'write_file',
          input: { path: externalFile, content: 'must-not-write' },
        }),
        JSON.stringify({ kind: 'final', text: '没有修改。', emotion: 'neutral' }),
      ]),
      store,
    );

    await service.run(
      {
        requestId: 'chat_external_denied',
        systemPrompt: '测试',
        messages: [{ role: 'user', content: `修改 ${externalFile}` }],
        selection,
        allowedActions: [],
      },
      { onStatus: () => undefined, requestApproval: async () => false },
    );

    expect(await readFile(externalFile, 'utf8')).toBe('unchanged');
  });

  it('confirms external directory listing, search, creation and exact replacement', async () => {
    const { store } = await createWorkspace();
    const externalDirectory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-external-tools-'));
    temporaryDirectories.push(externalDirectory);
    const externalFile = path.join(externalDirectory, 'code.ts');
    const createdDirectory = path.join(externalDirectory, 'created');
    await writeFile(externalFile, 'export const value = 1;\n');
    const service = new AssistantToolService(
      createModels([
        JSON.stringify({ kind: 'tool', tool: 'list_files', input: { path: externalDirectory } }),
        JSON.stringify({
          kind: 'tool',
          tool: 'search_files',
          input: { path: externalDirectory, query: 'value', filePattern: '.ts' },
        }),
        JSON.stringify({
          kind: 'tool',
          tool: 'create_directory',
          input: { path: createdDirectory },
        }),
        JSON.stringify({
          kind: 'tool',
          tool: 'replace_in_file',
          input: {
            path: externalFile,
            oldText: 'export const value = 1;',
            newText: 'export const value = 2;',
          },
        }),
        JSON.stringify({ kind: 'final', text: '外部操作完成。', emotion: 'neutral' }),
      ]),
      store,
    );
    const approvalTitles: string[] = [];

    await service.run(
      {
        requestId: 'chat_external_tools',
        systemPrompt: '测试',
        messages: [{ role: 'user', content: `处理 ${externalDirectory}` }],
        selection,
        allowedActions: [],
      },
      {
        onStatus: () => undefined,
        requestApproval: async ({ title }) => (approvalTitles.push(title), true),
      },
    );

    expect(approvalTitles).toEqual([
      '允许助手列出目录工作区外目标？',
      '允许助手搜索目录内容工作区外目标？',
      '允许助手创建目录工作区外目标？',
      '允许助手读取并修改文件工作区外目标？',
    ]);
    expect((await stat(createdDirectory)).isDirectory()).toBe(true);
    expect(await readFile(externalFile, 'utf8')).toBe('export const value = 2;\n');
  });

  it('writes atomically inside the selected workspace without per-file approval', async () => {
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
    let approvalRequests = 0;

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
        requestApproval: async () => ((approvalRequests += 1), false),
      },
    );

    expect(approvalRequests).toBe(0);
    expect(await readFile(path.join(directory, 'code.ts'), 'utf8')).toBe(
      'export const value = 2;\n',
    );
    expect(result.reply.text).toBe('已经修改。');
  });

  it('searches workspace text and applies an exact replacement without per-file approval', async () => {
    const { directory, store } = await createWorkspace();
    await writeFile(path.join(directory, 'code.ts'), 'const answer = 41;\nconst other = 1;\n');
    const service = new AssistantToolService(
      createModels([
        JSON.stringify({
          kind: 'tool',
          tool: 'search_files',
          input: { query: 'answer', path: '.', filePattern: '.ts' },
        }),
        JSON.stringify({ kind: 'tool', tool: 'read_file', input: { path: 'code.ts' } }),
        JSON.stringify({
          kind: 'tool',
          tool: 'replace_in_file',
          input: { path: 'code.ts', oldText: 'const answer = 41;', newText: 'const answer = 42;' },
        }),
        JSON.stringify({ kind: 'final', text: '已精确修改。', emotion: 'happy', action: null }),
      ]),
      store,
    );
    let approvalRequests = 0;

    const result = await service.run(
      {
        requestId: 'chat_replace',
        systemPrompt: '测试',
        messages: [{ role: 'user', content: '找到 answer 并改成 42' }],
        selection,
        allowedActions: [],
      },
      {
        onStatus: () => undefined,
        requestApproval: async () => ((approvalRequests += 1), false),
      },
    );

    expect(approvalRequests).toBe(0);
    expect(await readFile(path.join(directory, 'code.ts'), 'utf8')).toContain('answer = 42');
    expect(result.reply.text).toBe('已精确修改。');
  });

  it('creates a directory inside the selected workspace without per-directory approval', async () => {
    const { directory, store } = await createWorkspace();
    const service = new AssistantToolService(
      createModels([
        JSON.stringify({ kind: 'tool', tool: 'create_directory', input: { path: 'src' } }),
        JSON.stringify({ kind: 'final', text: '目录已建立。', emotion: 'neutral', action: null }),
      ]),
      store,
    );
    await service.run(
      {
        requestId: 'chat_mkdir',
        systemPrompt: '测试',
        messages: [{ role: 'user', content: '建立 src' }],
        selection,
        allowedActions: [],
      },
      {
        onStatus: () => undefined,
        requestApproval: async () => {
          throw new Error('workspace directory creation must not request approval');
        },
      },
    );
    expect((await stat(path.join(directory, 'src'))).isDirectory()).toBe(true);
  });

  it('runs only an approved fixed project check through the Main action', async () => {
    const { directory, store } = await createWorkspace();
    const checks: string[] = [];
    const service = new AssistantToolService(
      createModels([
        JSON.stringify({ kind: 'tool', tool: 'run_project_check', input: { check: 'typecheck' } }),
        JSON.stringify({ kind: 'final', text: '类型检查通过。', emotion: 'happy', action: null }),
      ]),
      store,
      globalThis.fetch,
      {
        runProjectCheck: async (root, check) => {
          expect(root).toBe(directory);
          checks.push(check);
          return 'typecheck 检查通过。';
        },
      },
    );
    const approvals: string[] = [];
    const result = await service.run(
      {
        requestId: 'chat_check',
        systemPrompt: '测试',
        messages: [{ role: 'user', content: '运行类型检查' }],
        selection,
        allowedActions: [],
      },
      {
        onStatus: () => undefined,
        requestApproval: async ({ description }) => (approvals.push(description), true),
      },
    );
    expect(checks).toEqual(['typecheck']);
    expect(approvals[0]).toContain('package.json 中的 typecheck 脚本');
    expect(result.reply.text).toBe('类型检查通过。');
  });

  it('opens only a safe existing workspace path without per-file approval', async () => {
    const { directory, store } = await createWorkspace();
    await writeFile(path.join(directory, 'guide.txt'), 'hello');
    const opened: string[] = [];
    const service = new AssistantToolService(
      createModels([
        JSON.stringify({ kind: 'tool', tool: 'open_file', input: { path: 'guide.txt' } }),
        JSON.stringify({ kind: 'final', text: '已经打开。', emotion: 'neutral', action: null }),
      ]),
      store,
      globalThis.fetch,
      { openPath: async (target) => (opened.push(target), '') },
    );
    let approvalRequests = 0;
    const result = await service.run(
      {
        requestId: 'chat_open',
        systemPrompt: '测试',
        messages: [{ role: 'user', content: '打开 guide.txt' }],
        selection,
        allowedActions: [],
      },
      {
        onStatus: () => undefined,
        requestApproval: async () => ((approvalRequests += 1), false),
      },
    );
    expect(opened).toEqual([path.join(directory, 'guide.txt')]);
    expect(approvalRequests).toBe(0);
    expect(result.reply.text).toBe('已经打开。');
  });

  it('opens a script-like workspace file only after explicit approval', async () => {
    const { directory, store } = await createWorkspace();
    await writeFile(path.join(directory, 'unsafe.cmd'), '@echo off');
    const opened: string[] = [];
    const service = new AssistantToolService(
      createModels([
        JSON.stringify({ kind: 'tool', tool: 'open_file', input: { path: 'unsafe.cmd' } }),
        JSON.stringify({
          kind: 'final',
          text: '已按确认打开脚本。',
          emotion: 'neutral',
          action: null,
        }),
      ]),
      store,
      globalThis.fetch,
      { openPath: async (target) => (opened.push(target), '') },
    );
    const approvals: string[] = [];
    const result = await service.run(
      {
        requestId: 'chat_open_script',
        systemPrompt: '测试',
        messages: [{ role: 'user', content: '打开 unsafe.cmd' }],
        selection,
        allowedActions: [],
      },
      {
        onStatus: () => undefined,
        requestApproval: async ({ description }) => (approvals.push(description), true),
      },
    );
    expect(opened).toEqual([path.join(directory, 'unsafe.cmd')]);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toContain('可能启动程序或执行脚本');
    expect(result.reply.text).toBe('已按确认打开脚本。');
  });

  it('opens an existing path outside the workspace only after explicit approval', async () => {
    const { store } = await createWorkspace();
    const externalDirectory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-external-open-'));
    temporaryDirectories.push(externalDirectory);
    const externalFile = path.join(externalDirectory, 'outside.txt');
    await writeFile(externalFile, 'outside');
    const canonicalExternalFile = await realpath(externalFile);
    const opened: string[] = [];
    const service = new AssistantToolService(
      createModels([
        JSON.stringify({ kind: 'tool', tool: 'open_file', input: { path: externalFile } }),
        JSON.stringify({
          kind: 'final',
          text: '已打开外部文件。',
          emotion: 'neutral',
          action: null,
        }),
      ]),
      store,
      globalThis.fetch,
      { openPath: async (target) => (opened.push(target), '') },
    );
    const approvals: string[] = [];
    await service.run(
      {
        requestId: 'chat_open_external',
        systemPrompt: '测试',
        messages: [{ role: 'user', content: `打开 ${externalFile}` }],
        selection,
        allowedActions: [],
      },
      {
        onStatus: () => undefined,
        requestApproval: async ({ description }) => (approvals.push(description), true),
      },
    );
    expect(opened).toEqual([canonicalExternalFile]);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toContain('工作区之外');
  });

  it('runs fixed media commands without per-command approval', async () => {
    const { store } = await createWorkspace();
    const commands: string[] = [];
    const service = new AssistantToolService(
      createModels([
        JSON.stringify({ kind: 'tool', tool: 'media_control', input: { command: 'next' } }),
        JSON.stringify({ kind: 'final', text: '已切到下一首。', emotion: 'happy', action: null }),
      ]),
      store,
      globalThis.fetch,
      { sendMediaCommand: async (command) => (commands.push(command), true) },
    );
    const result = await service.run(
      {
        requestId: 'chat_media',
        systemPrompt: '测试',
        messages: [{ role: 'user', content: '下一首' }],
        selection,
        allowedActions: [],
      },
      {
        onStatus: () => undefined,
        requestApproval: async () => {
          throw new Error('fixed media commands must not request approval');
        },
      },
    );
    expect(commands).toEqual(['next']);
    expect(result.reply.text).toBe('已切到下一首。');
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
