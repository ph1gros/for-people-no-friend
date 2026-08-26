import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
} from '@anthropic-ai/sdk';

import type {
  ChatEvent,
  ChatRequest,
  ConnectionResult,
  LlmProvider,
  ModelSelection,
  ProviderCapability,
} from '../../core/llm/contracts';
import {
  CancelledError,
  ConfigurationError,
  NetworkError,
  ProviderResponseError,
  normalizeProviderError,
  toPublicLlmError,
} from '../../core/llm/errors';
import { validateChatRequest, validateModelSelection } from './validation';

export interface AnthropicProviderOptions {
  getApiKey(): Promise<string | undefined>;
  baseURL?: string;
  maxRetries?: number;
  timeoutMs?: number;
}

export class AnthropicProvider implements LlmProvider {
  public readonly id = 'anthropic';
  public readonly displayName = 'Anthropic Claude';

  public constructor(private readonly options: AnthropicProviderOptions) {}

  public listCapabilities(modelId: string): ReadonlySet<ProviderCapability> {
    const capabilities = new Set<ProviderCapability>(['streaming']);
    if (/^claude-(?:opus|sonnet)-4-[5-9](?:-|$)|^claude-haiku-4-[5-9](?:-|$)/u.test(modelId)) {
      capabilities.add('structured-output');
    }
    return capabilities;
  }

  public async *streamChat(
    request: ChatRequest,
    selection: ModelSelection,
    signal?: AbortSignal,
  ): AsyncIterable<ChatEvent> {
    validateModelSelection(selection, this.id);
    validateChatRequest(request, this.id);
    if (signal?.aborted) {
      throw new CancelledError(this.id, signal.reason);
    }

    const apiKey = (await this.options.getApiKey())?.trim();
    if (!apiKey) {
      throw new ConfigurationError('An Anthropic API key is required.', this.id);
    }

    const timeoutMs = this.options.timeoutMs ?? 60_000;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const client = new Anthropic({
      apiKey,
      baseURL: this.options.baseURL,
      maxRetries: this.options.maxRetries ?? 0,
      timeout: timeoutMs,
    });

    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason = 'unknown';
    let completed = false;

    try {
      const stream = await client.messages.create(
        {
          model: selection.modelId.trim(),
          max_tokens: request.maxOutputTokens ?? 256,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.responseSchema
            ? {
                output_config: {
                  format: { type: 'json_schema' as const, schema: request.responseSchema },
                },
              }
            : {}),
          stream: true,
        },
        { signal: requestSignal },
      );

      for await (const event of stream) {
        switch (event.type) {
          case 'message_start':
            inputTokens =
              event.message.usage.input_tokens +
              (event.message.usage.cache_creation_input_tokens ?? 0) +
              (event.message.usage.cache_read_input_tokens ?? 0);
            break;
          case 'content_block_delta':
            if (event.delta.type === 'text_delta' && event.delta.text) {
              yield { type: 'text-delta', text: event.delta.text };
            }
            break;
          case 'message_delta':
            outputTokens = event.usage.output_tokens;
            finishReason = event.delta.stop_reason ?? finishReason;
            break;
          case 'message_stop':
            completed = true;
            yield { type: 'usage', inputTokens, outputTokens };
            yield { type: 'finish', reason: finishReason };
            break;
          default:
            break;
        }
      }
      if (!completed) {
        if (timeoutSignal.aborted && !signal?.aborted) {
          throw new NetworkError(this.id);
        }
        if (signal?.aborted) {
          throw new CancelledError(this.id, signal.reason);
        }
        throw new ProviderResponseError(this.id);
      }
    } catch (error) {
      if (timeoutSignal.aborted && !signal?.aborted) {
        throw new NetworkError(this.id, error);
      }
      if (
        error instanceof APIUserAbortError ||
        signal?.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw new CancelledError(this.id, error);
      }
      if (error instanceof APIConnectionError || error instanceof APIConnectionTimeoutError) {
        throw new NetworkError(this.id, error);
      }
      throw normalizeProviderError(error, this.id);
    }
  }

  public async testConnection(
    selection: ModelSelection,
    signal?: AbortSignal,
  ): Promise<ConnectionResult> {
    const startedAt = performance.now();
    try {
      for await (const event of this.streamChat(
        {
          systemPrompt: '',
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          maxOutputTokens: 1,
        },
        selection,
        signal,
      )) {
        void event;
        // Consuming the same streaming path verifies authentication, model access and parsing.
      }
      return { ok: true, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) };
    } catch (error) {
      return { ok: false, error: toPublicLlmError(error, this.id) };
    }
  }
}
