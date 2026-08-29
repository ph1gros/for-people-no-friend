import { afterEach, describe, expect, it } from 'vitest';

import { ModelRuntime, parseCharacterLoreOutput } from '../src/main/llm/model-runtime';
import type { SecretStore } from '../src/main/security/secret-store';
import type { ProviderConfigStore } from '../src/main/storage/provider-config-store';
import { readJsonBody, startFakeHttpServer, type FakeHttpServer } from './helpers/fake-http-server';

describe('character lore model output parsing', () => {
  let server: FakeHttpServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('accepts a complete JSON object even when the provider reports the token limit', () => {
    expect(
      parseCharacterLoreOutput(
        '```json\n{"identity":"枫丹前任水神","sampleLines":[]}\n```',
        'fake',
        'max_tokens',
      ),
    ).toMatchObject({ identity: '枫丹前任水神', sampleLines: [] });
  });

  it('repairs only trailing JSON commas and rejects genuinely truncated output', () => {
    expect(
      parseCharacterLoreOutput('{"identity":"芙宁娜", "relationships": [],}', 'fake'),
    ).toMatchObject({ identity: '芙宁娜', relationships: [] });
    expect(() =>
      parseCharacterLoreOutput('{"identity":"芙宁娜", "relationships": [', 'fake', 'max_tokens'),
    ).toThrow('invalid or unsuccessful response');
    expect(() => parseCharacterLoreOutput('', 'fake', 'length')).toThrow(
      'invalid or unsuccessful response',
    );
  });

  it('uses a focused second pass when relationship evidence exists but the first result omits it', async () => {
    const requests: Array<Record<string, unknown>> = [];
    server = await startFakeHttpServer((request, response) => {
      void (async () => {
        requests.push((await readJsonBody(request)) as Record<string, unknown>);
        const content =
          requests.length === 1
            ? JSON.stringify({
                aliases: [],
                identity: '高中一年级学生兼读者模特。',
                personality: '开朗直率。',
                background: '因制作角色扮演服装与新菜逐渐熟识。',
                relationships: [],
                userDisplayName: '',
                speechStyle: '表达直接而热情。',
                sampleLines: [],
                roleplayExamples: [],
              })
            : JSON.stringify({
                relationships: ['五条新菜：同班同学，在共同制作服装后逐渐喜欢上对方。'],
              });
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(
          `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        );
      })();
    });
    const configuration = {
      getConversationSelection: async () => ({
        providerId: 'openai-compatible',
        modelId: 'fake-local-model',
      }),
      getProviderConfiguration: async () => ({
        openAICompatibleBaseUrl: `${server?.baseUrl}/v1`,
        allowRemoteComplexTasks: false,
      }),
      getOpenAICompatibleBaseUrl: async () => `${server?.baseUrl}/v1`,
    } as unknown as ProviderConfigStore;
    const secrets = { get: async () => undefined } as unknown as SecretStore;
    const runtime = new ModelRuntime(secrets, configuration);

    const result = await runtime.generateCharacterLore({
      canonicalName: '喜多川海梦',
      sourceWork: '更衣人偶坠入爱河',
      sourceText:
        '[source_1] 喜多川海梦\n与新菜同为一年级同学。在共同制作服装期间逐渐熟识，后来意识到自己喜欢上了新菜。',
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining('喜多川海梦') }),
      ]),
    );
    expect(JSON.stringify(requests[0])).toContain('line 默认只写角色实际说出口的话');
    expect(requests[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining('喜欢上了新菜') }),
      ]),
    );
    expect(result.relationships).toEqual(['五条新菜：同班同学，在共同制作服装后逐渐喜欢上对方。']);
  });
});
