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
  errorFromHttpStatus,
  normalizeProviderError,
  toPublicLlmError,
} from '../../core/llm/errors';
import { iterateSseData } from './sse';
import { validateChatRequest, validateModelSelection } from './validation';

export interface OpenAICompatibleConfiguration {
  baseUrl: string;
  apiKey?: string;
}

export interface OpenAICompatibleProviderOptions {
  getConfiguration(): Promise<OpenAICompatibleConfiguration>;
  providerId?: string;
  displayName?: string;
  requireApiKey?: boolean;
  supportsJsonOutput?: boolean;
  disableThinkingForStructuredOutput?: boolean;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  } | null;
  error?: { message?: string };
}

const isLoopbackHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
};

export const resolveChatCompletionsUrl = (baseUrl: string): URL => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ConfigurationError('The OpenAI-compatible base URL is invalid.', 'openai-compatible');
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new ConfigurationError(
      'The OpenAI-compatible base URL cannot include credentials, a query or a fragment.',
      'openai-compatible',
    );
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
    throw new ConfigurationError(
      'Use HTTPS for remote providers; HTTP is allowed only for localhost.',
      'openai-compatible',
    );
  }

  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/chat/completions') ? path : `${path || ''}/chat/completions`;
  return url;
};

const readProviderError = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: { message?: unknown }; message?: unknown };
    const message = body.error?.message ?? body.message;
    return typeof message === 'string' ? message.slice(0, 1_000) : '';
  } catch {
    return '';
  }
};

export class OpenAICompatibleProvider implements LlmProvider {
  public readonly id: string;
  public readonly displayName: string;

  public constructor(private readonly options: OpenAICompatibleProviderOptions) {
    this.id = options.providerId ?? 'openai-compatible';
    this.displayName = options.displayName ?? 'OpenAI Compatible';
  }

  public listCapabilities(): ReadonlySet<ProviderCapability> {
    return new Set<ProviderCapability>([
      'streaming',
      ...(this.options.supportsJsonOutput ? (['structured-output'] as const) : []),
    ]);
  }

  public async *streamChat(
    request: ChatRequest,
    selection: ModelSelection,
    signal?: AbortSignal,
  ): AsyncIterable<ChatEvent> {
    validateModelSelection(selection, this.id);
    validateChatRequest(request, this.id);
    if (request.responseSchema !== undefined && !this.options.supportsJsonOutput) {
      throw new ConfigurationError(
        'Structured output is not enabled for this compatibility provider.',
        this.id,
      );
    }
    if (signal?.aborted) {
      throw new CancelledError(this.id, signal.reason);
    }

    const configuration = await this.options.getConfiguration();
    const endpoint = resolveChatCompletionsUrl(configuration.baseUrl);
    const apiKey = configuration.apiKey?.trim();
    if (this.options.requireApiKey && !apiKey) {
      throw new ConfigurationError(`An API key is required for ${this.displayName}.`, this.id);
    }
    const fetchImplementation = this.options.fetch ?? globalThis.fetch;

    const timeoutSignal = AbortSignal.timeout(
      request.timeoutMs ?? this.options.timeoutMs ?? 60_000,
    );
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
      response = await fetchImplementation(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: selection.modelId.trim(),
          messages: [
            ...(request.systemPrompt
              ? [{ role: 'system' as const, content: request.systemPrompt }]
              : []),
            ...request.messages,
          ],
          stream: true,
          ...(request.responseSchema !== undefined && this.options.supportsJsonOutput
            ? { response_format: { type: 'json_object' as const } }
            : {}),
          ...(request.responseSchema !== undefined &&
          this.options.disableThinkingForStructuredOutput
            ? { thinking: { type: 'disabled' as const } }
            : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}),
        }),
        signal: requestSignal,
      });
    } catch (error) {
      if (timeoutSignal.aborted && !signal?.aborted) {
        throw new NetworkError(this.id, error);
      }
      throw normalizeProviderError(error, this.id);
    }

    if (!response.ok) {
      const providerMessage = await readProviderError(response);
      throw errorFromHttpStatus(response.status, this.id, providerMessage);
    }
    if (!response.body) {
      throw new ProviderResponseError(this.id);
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: string | undefined;
    let completed = false;

    try {
      for await (const data of iterateSseData(response.body)) {
        if (data === '[DONE]') {
          completed = true;
          break;
        }

        let chunk: ChatCompletionChunk;
        try {
          chunk = JSON.parse(data) as ChatCompletionChunk;
        } catch (error) {
          throw new ProviderResponseError(this.id, error);
        }
        if (chunk.error) {
          throw new ProviderResponseError(this.id);
        }

        const choice = chunk.choices?.[0];
        if (choice?.delta?.content) {
          yield { type: 'text-delta', text: choice.delta.content };
        }
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
          completed = true;
        }
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
          outputTokens = chunk.usage.completion_tokens ?? outputTokens;
        }
      }
    } catch (error) {
      if (timeoutSignal.aborted && !signal?.aborted) {
        throw new NetworkError(this.id, error);
      }
      throw normalizeProviderError(error, this.id);
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
    yield { type: 'usage', inputTokens, outputTokens };
    yield { type: 'finish', reason: finishReason ?? 'unknown' };
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
        // Connection tests intentionally use the normal streaming parser.
      }
      return { ok: true, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) };
    } catch (error) {
      return { ok: false, error: toPublicLlmError(error, this.id) };
    }
  }
}
