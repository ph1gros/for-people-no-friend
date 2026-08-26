import { afterEach, describe, expect, it } from 'vitest';

import { AnthropicProvider } from '../src/adapters/llm/anthropic-provider';
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

const anthropicStream = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_fake","type":"message","role":"assistant","model":"fake-claude","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":3,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"","citations":null}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":3,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
  '',
].join('\n');

describe('AnthropicProvider integration', () => {
  let server: FakeHttpServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('uses the official SDK Messages stream and converts it to internal events', async () => {
    let requestPath = '';
    let requestHeaders: Record<string, string | string[] | undefined> = {};
    let requestBody: unknown;

    server = await startFakeHttpServer((request, response) => {
      void (async () => {
        requestPath = request.url ?? '';
        requestHeaders = request.headers;
        requestBody = await readJsonBody(request);
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(anthropicStream);
      })();
    });

    const provider = new AnthropicProvider({
      getApiKey: async () => 'fake-anthropic-key',
      baseURL: server.baseUrl,
      maxRetries: 0,
    });
    const events = await collect(
      provider.streamChat(
        {
          systemPrompt: 'Stay concise.',
          messages: [{ role: 'user', content: 'Hello' }],
          responseSchema: {
            type: 'object',
            properties: { reply: { type: 'string' } },
            required: ['reply'],
            additionalProperties: false,
          },
          maxOutputTokens: 16,
        },
        { providerId: 'anthropic', modelId: 'fake-claude' },
      ),
    );

    expect(requestPath).toBe('/v1/messages');
    expect(requestHeaders['x-api-key']).toBe('fake-anthropic-key');
    expect(requestHeaders['anthropic-version']).toBeTruthy();
    expect(requestBody).toMatchObject({
      model: 'fake-claude',
      system: 'Stay concise.',
      messages: [{ role: 'user', content: 'Hello' }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { reply: { type: 'string' } },
            required: ['reply'],
            additionalProperties: false,
          },
        },
      },
      stream: true,
    });
    expect(events).toEqual([
      { type: 'text-delta', text: 'Hello' },
      { type: 'usage', inputTokens: 3, outputTokens: 1 },
      { type: 'finish', reason: 'end_turn' },
    ]);
    expect(provider.listCapabilities('claude-opus-4-6')).toContain('structured-output');
    expect(provider.listCapabilities('claude-3-haiku')).not.toContain('structured-output');
  });

  it('maps SDK authentication failures to the unified public error', async () => {
    server = await startFakeHttpServer((_request, response) => {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'authentication_error', message: 'fake rejection' },
        }),
      );
    });

    const provider = new AnthropicProvider({
      getApiKey: async () => 'fake-rejected-key',
      baseURL: server.baseUrl,
      maxRetries: 0,
    });
    const result = await provider.testConnection({
      providerId: 'anthropic',
      modelId: 'fake-claude',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'authentication',
        message: 'The API key was rejected by the provider.',
        retryable: false,
      },
    });
  });

  it('maps an SDK request timeout to retryable network error', async () => {
    server = await startFakeHttpServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_fake","type":"message","role":"assistant","model":"fake-claude","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}\n\n',
      );
    });

    const provider = new AnthropicProvider({
      getApiKey: async () => 'fake-anthropic-key',
      baseURL: server.baseUrl,
      maxRetries: 0,
      timeoutMs: 20,
    });
    const result = await provider.testConnection({
      providerId: 'anthropic',
      modelId: 'fake-claude',
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
  it('propagates AbortSignal cancellation as CancelledError', async () => {
    server = await startFakeHttpServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_fake","type":"message","role":"assistant","model":"fake-claude","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}\n\n',
      );
    });

    const provider = new AnthropicProvider({
      getApiKey: async () => 'fake-anthropic-key',
      baseURL: server.baseUrl,
      maxRetries: 0,
    });
    const controller = new AbortController();
    const promise = collect(
      provider.streamChat(
        {
          systemPrompt: '',
          messages: [{ role: 'user', content: 'wait' }],
        },
        { providerId: 'anthropic', modelId: 'fake-claude' },
        controller.signal,
      ),
    );
    setTimeout(() => controller.abort(), 20);

    await expect(promise).rejects.toBeInstanceOf(CancelledError);
  });
});
