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
}

export interface CancelConversationInput {
  requestId: string;
}

export type StartConversationResult = { ok: true } | { ok: false; error: PublicLlmError };

export type ConversationEvent =
  | { requestId: string; type: 'started'; userMessage: ConversationMessage }
  | { requestId: string; type: 'text-delta'; text: string }
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
  if (
    typeof message !== 'string' ||
    message.trim().length === 0 ||
    message.length > 8_000 ||
    !Array.isArray(actions) ||
    actions.length > 64 ||
    !actions.every((action) => typeof action === 'string' && ACTION_PATTERN.test(action))
  ) {
    throw new Error('The conversation request is invalid.');
  }
  return {
    requestId: parseRequestId('requestId' in value ? value.requestId : undefined),
    message: message.trim(),
    availableActions: [...new Set(actions)],
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

export const parseCharacterProfileIdInput = (value: unknown): { id: string } => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(value.id)
  ) {
    throw new Error('The character profile ID is invalid.');
  }
  return { id: value.id };
};

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
    if (value.type === 'text-delta' && 'text' in value && typeof value.text === 'string') {
      return { requestId, type: 'text-delta', text: value.text.slice(0, 32_768) };
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
