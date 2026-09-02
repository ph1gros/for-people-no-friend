import type { CharacterEmotion } from '../core/character/character-reply';
import { CHARACTER_EMOTIONS } from '../core/character/character-reply';
import type { CharacterProfile } from '../core/conversation/character-profile';
import { validateCharacterProfile } from '../core/conversation/character-profile';
import type { ModelSelection, PublicLlmError } from '../core/llm/contracts';
import { parseProviderId } from './model-ipc';

export type ConversationMessageStatus = 'complete' | 'cancelled';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  status: ConversationMessageStatus;
  emotion?: CharacterEmotion;
  action?: string;
  providerId?: string;
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface StartConversationInput {
  requestId: string;
  message: string;
  availableActions: string[];
  assistantMode: boolean;
  wakeFromDrowsy?: boolean;
}

export interface ConversationContextDebug {
  providerId: string;
  modelId: string;
  recentMessageCount: number;
  sources: Array<{ name: string; characters: number; reason: string }>;
  roleplayExamples: Array<{ scene: string; line: string; score: number; reasons: string[] }>;
  fallbacks: string[];
}

export interface CancelConversationInput {
  requestId: string;
}

export interface ContextualOpeningLineResult {
  line: string;
  emotion: CharacterEmotion;
}

export type StartConversationResult = { ok: true } | { ok: false; error: PublicLlmError };

export type ConversationEvent =
  | { requestId: string; type: 'started'; userMessage: ConversationMessage }
  | { requestId: string; type: 'context-debug'; debug: ConversationContextDebug }
  | { requestId: string; type: 'text-delta'; text: string }
  | { requestId: string; type: 'tool-status'; label: string }
  | {
      requestId: string;
      type: 'tool-approval';
      approvalId: string;
      title: string;
      description: string;
    }
  | { requestId: string; type: 'completed'; assistantMessage: ConversationMessage }
  | { requestId: string; type: 'cancelled'; assistantMessage?: ConversationMessage }
  | { requestId: string; type: 'error'; error: PublicLlmError };

export interface ConversationConfiguration {
  selection?: ModelSelection;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ACTION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const emotionSet = new Set<string>(CHARACTER_EMOTIONS);

const parseRequestId = (value: unknown): string => {
  if (typeof value !== 'string' || !REQUEST_ID_PATTERN.test(value)) {
    throw new Error('The conversation request ID is invalid.');
  }
  return value;
};

export const parseStartConversationInput = (value: unknown): StartConversationInput => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The conversation request is invalid.');
  }
  const message = 'message' in value ? value.message : undefined;
  const actions = 'availableActions' in value ? value.availableActions : undefined;
  const assistantMode = 'assistantMode' in value ? value.assistantMode : false;
  const wakeFromDrowsy = 'wakeFromDrowsy' in value ? value.wakeFromDrowsy : false;
  if (
    typeof message !== 'string' ||
    message.trim().length === 0 ||
    message.length > 16_000 ||
    !Array.isArray(actions) ||
    actions.length > 64 ||
    !actions.every((action) => typeof action === 'string' && ACTION_PATTERN.test(action)) ||
    typeof assistantMode !== 'boolean' ||
    typeof wakeFromDrowsy !== 'boolean'
  ) {
    throw new Error('The conversation request is invalid.');
  }
  return {
    requestId: parseRequestId('requestId' in value ? value.requestId : undefined),
    message: message.trim(),
    availableActions: [...new Set(actions)],
    assistantMode,
    wakeFromDrowsy,
  };
};

export const parseCancelConversationInput = (value: unknown): CancelConversationInput => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The cancellation request is invalid.');
  }
  return { requestId: parseRequestId('requestId' in value ? value.requestId : undefined) };
};

export const parseConversationConfiguration = (value: unknown): ConversationConfiguration => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The conversation configuration is invalid.');
  }
  const selection = 'selection' in value ? value.selection : undefined;
  if (selection === undefined || selection === null) {
    return {};
  }
  if (typeof selection !== 'object' || selection === null) {
    throw new Error('The conversation model selection is invalid.');
  }
  const modelId = 'modelId' in selection ? selection.modelId : undefined;
  if (typeof modelId !== 'string' || modelId.trim().length === 0 || modelId.length > 256) {
    throw new Error('The conversation model selection is invalid.');
  }
  return {
    selection: {
      providerId: parseProviderId('providerId' in selection ? selection.providerId : undefined),
      modelId: modelId.trim(),
    },
  };
};

export const parseCharacterProfileInput = (value: unknown): CharacterProfile =>
  validateCharacterProfile(value);

const isPublicError = (value: unknown): value is PublicLlmError =>
  typeof value === 'object' &&
  value !== null &&
  'code' in value &&
  typeof value.code === 'string' &&
  'message' in value &&
  typeof value.message === 'string' &&
  'retryable' in value &&
  typeof value.retryable === 'boolean';

const isConversationMessage = (value: unknown): value is ConversationMessage =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  typeof value.id === 'string' &&
  'role' in value &&
  (value.role === 'user' || value.role === 'assistant') &&
  'content' in value &&
  typeof value.content === 'string' &&
  'createdAt' in value &&
  typeof value.createdAt === 'number' &&
  'status' in value &&
  (value.status === 'complete' || value.status === 'cancelled') &&
  (!('emotion' in value) ||
    value.emotion === undefined ||
    (typeof value.emotion === 'string' && emotionSet.has(value.emotion)));

const parseContextDebug = (value: unknown): ConversationContextDebug | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.providerId !== 'string' ||
    record.providerId.length > 100 ||
    typeof record.modelId !== 'string' ||
    record.modelId.length > 256 ||
    typeof record.recentMessageCount !== 'number' ||
    !Number.isInteger(record.recentMessageCount) ||
    record.recentMessageCount < 0 ||
    !Array.isArray(record.sources) ||
    record.sources.length > 12 ||
    !Array.isArray(record.roleplayExamples) ||
    record.roleplayExamples.length > 4 ||
    !Array.isArray(record.fallbacks) ||
    !record.fallbacks.every((item) => typeof item === 'string' && item.length <= 300)
  ) {
    return undefined;
  }
  const sources = record.sources.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error();
    const source = item as Record<string, unknown>;
    if (
      typeof source.name !== 'string' ||
      source.name.length > 100 ||
      typeof source.characters !== 'number' ||
      !Number.isInteger(source.characters) ||
      source.characters < 0 ||
      typeof source.reason !== 'string' ||
      source.reason.length > 300
    ) {
      throw new Error();
    }
    return { name: source.name, characters: source.characters, reason: source.reason };
  });
  const roleplayExamples = record.roleplayExamples.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error();
    const example = item as Record<string, unknown>;
    if (
      typeof example.scene !== 'string' ||
      example.scene.length > 80 ||
      typeof example.line !== 'string' ||
      example.line.length > 60 ||
      typeof example.score !== 'number' ||
      !Number.isFinite(example.score) ||
      !Array.isArray(example.reasons) ||
      !example.reasons.every((reason) => typeof reason === 'string' && reason.length <= 200)
    ) {
      throw new Error();
    }
    return {
      scene: example.scene,
      line: example.line,
      score: example.score,
      reasons: example.reasons as string[],
    };
  });
  return {
    providerId: record.providerId,
    modelId: record.modelId,
    recentMessageCount: record.recentMessageCount,
    sources,
    roleplayExamples,
    fallbacks: record.fallbacks as string[],
  };
};

export const parseConversationEvent = (value: unknown): ConversationEvent | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('requestId' in value) ||
    !('type' in value)
  ) {
    return undefined;
  }
  try {
    const requestId = parseRequestId(value.requestId);
    if (value.type === 'context-debug' && 'debug' in value) {
      const debug = parseContextDebug(value.debug);
      return debug ? { requestId, type: 'context-debug', debug } : undefined;
    }
    if (value.type === 'text-delta' && 'text' in value && typeof value.text === 'string') {
      return { requestId, type: 'text-delta', text: value.text.slice(0, 32_768) };
    }
    if (
      value.type === 'tool-status' &&
      'label' in value &&
      typeof value.label === 'string' &&
      value.label.length <= 200
    ) {
      return { requestId, type: 'tool-status', label: value.label };
    }
    if (
      value.type === 'tool-approval' &&
      'approvalId' in value &&
      typeof value.approvalId === 'string' &&
      REQUEST_ID_PATTERN.test(value.approvalId) &&
      'title' in value &&
      typeof value.title === 'string' &&
      value.title.length <= 200 &&
      'description' in value &&
      typeof value.description === 'string' &&
      value.description.length <= 1_000
    ) {
      return {
        requestId,
        type: 'tool-approval',
        approvalId: value.approvalId,
        title: value.title,
        description: value.description,
      };
    }
    if (
      value.type === 'started' &&
      'userMessage' in value &&
      isConversationMessage(value.userMessage)
    ) {
      return { requestId, type: 'started', userMessage: value.userMessage };
    }
    if (
      value.type === 'completed' &&
      'assistantMessage' in value &&
      isConversationMessage(value.assistantMessage)
    ) {
      return { requestId, type: 'completed', assistantMessage: value.assistantMessage };
    }
    if (value.type === 'cancelled') {
      const assistantMessage =
        'assistantMessage' in value && isConversationMessage(value.assistantMessage)
          ? value.assistantMessage
          : undefined;
      return { requestId, type: 'cancelled', ...(assistantMessage ? { assistantMessage } : {}) };
    }
    if (value.type === 'error' && 'error' in value && isPublicError(value.error)) {
      return { requestId, type: 'error', error: value.error };
    }
  } catch {
    return undefined;
  }
  return undefined;
};
