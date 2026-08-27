import type { ChatRequest, ModelSelection } from '../../core/llm/contracts';
import { ConfigurationError } from '../../core/llm/errors';

const MAX_MODEL_ID_LENGTH = 256;
const MAX_PROMPT_LENGTH = 1_000_000;
const MAX_MESSAGES = 10_000;

export const validateModelSelection = (
  selection: ModelSelection,
  expectedProviderId: string,
): void => {
  if (selection.providerId !== expectedProviderId) {
    throw new ConfigurationError(
      `Provider "${expectedProviderId}" cannot handle selection "${selection.providerId}".`,
      expectedProviderId,
    );
  }
  if (
    typeof selection.modelId !== 'string' ||
    selection.modelId.trim().length === 0 ||
    selection.modelId.length > MAX_MODEL_ID_LENGTH
  ) {
    throw new ConfigurationError('A valid model ID is required.', expectedProviderId);
  }
};

export const validateChatRequest = (request: ChatRequest, providerId: string): void => {
  if (
    typeof request.systemPrompt !== 'string' ||
    request.systemPrompt.length > MAX_PROMPT_LENGTH ||
    !Array.isArray(request.messages) ||
    request.messages.length === 0 ||
    request.messages.length > MAX_MESSAGES
  ) {
    throw new ConfigurationError('The chat request is invalid.', providerId);
  }
  for (const message of request.messages) {
    if (
      (message.role !== 'user' && message.role !== 'assistant') ||
      typeof message.content !== 'string' ||
      message.content.length === 0 ||
      message.content.length > MAX_PROMPT_LENGTH
    ) {
      throw new ConfigurationError('The chat request contains an invalid message.', providerId);
    }
  }
  if (
    request.temperature !== undefined &&
    (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)
  ) {
    throw new ConfigurationError('Temperature must be between 0 and 2.', providerId);
  }
  if (
    request.maxOutputTokens !== undefined &&
    (!Number.isInteger(request.maxOutputTokens) ||
      request.maxOutputTokens < 1 ||
      request.maxOutputTokens > 1_000_000)
  ) {
    throw new ConfigurationError('The output token limit is invalid.', providerId);
  }
  if (
    request.timeoutMs !== undefined &&
    (!Number.isInteger(request.timeoutMs) ||
      request.timeoutMs < 1_000 ||
      request.timeoutMs > 300_000)
  ) {
    throw new ConfigurationError('The request timeout is invalid.', providerId);
  }
};
