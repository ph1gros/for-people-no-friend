import { afterEach, describe, expect, it } from 'vitest';

import {
  OpenAICompatibleProvider,
  resolveChatCompletionsUrl,
} from '../src/adapters/llm/openai-compatible-provider';
import type { ChatEvent } from '../src/core/llm/contracts';
import { CancelledError } from '../src/core/llm/errors';
import { startFakeHttpServer, readJsonBody, type FakeHttpServer } from './helpers/fake-http-server';

const collect = async (events: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> => {
  const collected: ChatEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
};

describe('OpenAICompatibleProvider integration', () => {
  let server: FakeHttpServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('parses broadly compatible Chat Completions data-only SSE', async () => {
    let requestPath = '';
    let requestAuthorization: string | undefined;
    let requestBody: unknown;

    server = await startFakeHttpServer((request, response) => {
      void (async () => {
        requestPath = request.url ?? '';
        requestAuthorization = request.headers.authorization;
        requestBody = await readJsonBody(request);
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(
          'data: {"choices":[{"delta":{"role":"assistant","content":"Hel"},"finish_reason":null}]}\r\n\r\n',
        );
        response.write(
          'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n',
        );
        response.end('data: [DONE]\n\n');
      })();
    });

    const provider = new OpenAICompatibleProvider({
      getConfiguration: async () => ({
        baseUrl: `${server?.baseUrl}/v1/`,
        apiKey: 'fake-openai-key',
      }),
    });
    const events = await collect(
      provider.streamChat(
        {
          systemPrompt: 'Stay concise.',
          messages: [{ role: 'user', content: 'Hello' }],
          temperature: 0.2,
          maxOutputTokens: 8,
        },
        { providerId: 'openai-compatible', modelId: 'fake-chat-model' },
      ),
    );

    expect(requestPath).toBe('/v1/chat/completions');
    expect(requestAuthorization).toBe('Bearer fake-openai-key');
    expect(requestBody).toMatchObject({
      model: 'fake-chat-model',
      messages: [
        { role: 'system', content: 'Stay concise.' },
        { role: 'user', content: 'Hello' },
      ],
      stream: true,
      temperature: 0.2,
      max_tokens: 8,
    });
    expect(events).toEqual([
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo' },
      { type: 'usage', inputTokens: 4, outputTokens: 2 },
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('maps HTTP errors and rejects malformed SSE', async () => {
    server = await startFakeHttpServer((_request, response) => {
      response.writeHead(429, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'fake quota' } }));
    });
    const provider = new OpenAICompatibleProvider({
      getConfiguration: async () => ({ baseUrl: `${server?.baseUrl}/v1` }),
    });

    const result = await provider.testConnection({
      providerId: 'openai-compatible',
      modelId: 'fake-model',
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'rate-limit',
        message: 'The provider rate limit or quota was reached.',
        retryable: true,
      },
    });
  });

  it('maps an in-flight timeout to retryable network error', async () => {
    server = await startFakeHttpServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(
        'data: {"choices":[{"delta":{"content":"waiting"},"finish_reason":null}]}\n\n',
      );
    });
    const provider = new OpenAICompatibleProvider({
      getConfiguration: async () => ({ baseUrl: `${server?.baseUrl}/v1` }),
      timeoutMs: 20,
    });

    const result = await provider.testConnection({
      providerId: 'openai-compatible',
      modelId: 'fake-model',
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'network',
        message: 'The model provider could not be reached.',
        retryable: true,
      },
    });
  });
  it('cancels an in-flight SSE response', async () => {
    server = await startFakeHttpServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(
        'data: {"choices":[{"delta":{"content":"waiting"},"finish_reason":null}]}\n\n',
      );
    });
    const provider = new OpenAICompatibleProvider({
      getConfiguration: async () => ({ baseUrl: `${server?.baseUrl}/v1` }),
    });
    const controller = new AbortController();
    const promise = collect(
      provider.streamChat(
        {
          systemPrompt: '',
          messages: [{ role: 'user', content: 'wait' }],
        },
        { providerId: 'openai-compatible', modelId: 'fake-model' },
        controller.signal,
      ),
    );
    setTimeout(() => controller.abort(), 20);

    await expect(promise).rejects.toBeInstanceOf(CancelledError);
  });

  it('allows localhost HTTP but rejects remote plaintext and embedded credentials', () => {
    expect(resolveChatCompletionsUrl('http://127.0.0.1:11434/v1').href).toBe(
      'http://127.0.0.1:11434/v1/chat/completions',
    );
    expect(() => resolveChatCompletionsUrl('http://example.com/v1')).toThrow(/HTTPS/);
    expect(() => resolveChatCompletionsUrl('https://key@example.com/v1')).toThrow(/credentials/);
  });
});
