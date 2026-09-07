import { describe, expect, it } from 'vitest';
import { ModelRuntime } from '../src/main/llm/model-runtime';
import type { SecretStore } from '../src/main/security/secret-store';
import type { ProviderConfigStore } from '../src/main/storage/provider-config-store';
import { readJsonBody, startFakeHttpServer } from './helpers/fake-http-server';

describe('speech language conversion', () => {
  it('uses the selected provider, quotes input as data, and validates the requested output language', async () => {
    const requests: Record<string, unknown>[] = [];
    let translated = 'Hello, let us go for a walk.';
    const server = await startFakeHttpServer((request, response) => {
      void (async () => {
        requests.push((await readJsonBody(request)) as Record<string, unknown>);
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(
          `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ text: translated }) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        );
      })();
    });
    try {
      const configuration = {
        getConversationSelection: async () => ({
          providerId: 'openai-compatible',
          modelId: 'fake-local-model',
        }),
        getProviderConfiguration: async () => ({
          openAICompatibleBaseUrl: `${server.baseUrl}/v1`,
          allowRemoteComplexTasks: false,
        }),
        getOpenAICompatibleBaseUrl: async () => `${server.baseUrl}/v1`,
      } as unknown as ProviderConfigStore;
      const runtime = new ModelRuntime(
        { get: async () => undefined } as unknown as SecretStore,
        configuration,
      );
      expect(await runtime.translateSpeechToEnglish('你好，我们去散步吧。')).toBe(translated);
      expect(requests[0].messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system', content: expect.stringContaining('自然英语') }),
          { role: 'user', content: JSON.stringify({ text: '你好，我们去散步吧。' }) },
        ]),
      );
      translated = '你好';
      await expect(runtime.translateSpeechToEnglish('你好')).rejects.toThrow();
      translated = 'こんにちは。';
      expect(await runtime.translateSpeechToJapanese('你好')).toBe(translated);
    } finally {
      await server.close();
    }
  });
});
