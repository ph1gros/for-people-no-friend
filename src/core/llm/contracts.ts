export type ProviderCapability = 'streaming' | 'structured-output' | 'vision' | 'tool-use';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ModelSelection {
  providerId: string;
  modelId: string;
}

export interface ChatRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export type ChatEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'structured-result'; value: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'finish'; reason: string };

export type ConnectionResult =
  { ok: true; latencyMs: number } | { ok: false; error: PublicLlmError };

export interface PublicLlmError {
  code: LlmErrorCode;
  message: string;
  retryable: boolean;
}

export type LlmErrorCode =
  | 'authentication'
  | 'rate-limit'
  | 'network'
  | 'model-not-found'
  | 'context-too-long'
  | 'provider-response'
  | 'cancelled'
  | 'configuration';

export interface LlmProvider {
  readonly id: string;
  readonly displayName: string;

  listCapabilities(modelId: string): ReadonlySet<ProviderCapability>;

  streamChat(
    request: ChatRequest,
    selection: ModelSelection,
    signal?: AbortSignal,
  ): AsyncIterable<ChatEvent>;

  testConnection(selection: ModelSelection, signal?: AbortSignal): Promise<ConnectionResult>;
}

export type ModelTask = 'conversation' | 'memoryExtraction' | 'summarization' | 'characterResearch';

export type ModelAssignments = Record<ModelTask, ModelSelection>;
