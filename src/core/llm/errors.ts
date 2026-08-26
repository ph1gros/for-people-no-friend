import type { LlmErrorCode, PublicLlmError } from './contracts';

interface LlmErrorOptions {
  providerId?: string;
  retryable?: boolean;
  status?: number;
  cause?: unknown;
}

export class LlmError extends Error {
  public readonly code: LlmErrorCode;
  public readonly providerId: string | undefined;
  public readonly retryable: boolean;
  public readonly status: number | undefined;

  public constructor(code: LlmErrorCode, message: string, options: LlmErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.providerId = options.providerId;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

export class AuthenticationError extends LlmError {
  public constructor(providerId?: string, cause?: unknown) {
    super('authentication', 'The API key was rejected by the provider.', {
      providerId,
      cause,
    });
  }
}

export class RateLimitError extends LlmError {
  public constructor(providerId?: string, cause?: unknown) {
    super('rate-limit', 'The provider rate limit or quota was reached.', {
      providerId,
      retryable: true,
      cause,
    });
  }
}

export class NetworkError extends LlmError {
  public constructor(providerId?: string, cause?: unknown) {
    super('network', 'The model provider could not be reached.', {
      providerId,
      retryable: true,
      cause,
    });
  }
}

export class ModelNotFoundError extends LlmError {
  public constructor(providerId?: string, cause?: unknown) {
    super('model-not-found', 'The selected model was not found.', {
      providerId,
      cause,
    });
  }
}

export class ContextTooLongError extends LlmError {
  public constructor(providerId?: string, cause?: unknown) {
    super('context-too-long', 'The request is longer than the model context window.', {
      providerId,
      cause,
    });
  }
}

export class ProviderResponseError extends LlmError {
  public constructor(providerId?: string, cause?: unknown, status?: number) {
    super('provider-response', 'The provider returned an invalid or unsuccessful response.', {
      providerId,
      retryable: status !== undefined && status >= 500,
      status,
      cause,
    });
  }
}

export class CancelledError extends LlmError {
  public constructor(providerId?: string, cause?: unknown) {
    super('cancelled', 'The model request was cancelled.', {
      providerId,
      cause,
    });
  }
}

export class ConfigurationError extends LlmError {
  public constructor(message = 'The model provider is not configured.', providerId?: string) {
    super('configuration', message, { providerId });
  }
}

export const isAbortError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'AbortError' ||
    error.name === 'APIUserAbortError' ||
    error.message.toLowerCase().includes('aborted'));

export const errorFromHttpStatus = (
  status: number,
  providerId: string,
  providerMessage = '',
): LlmError => {
  const normalizedMessage = providerMessage.toLowerCase();
  if (status === 401 || status === 403) {
    return new AuthenticationError(providerId);
  }
  if (status === 404) {
    return new ModelNotFoundError(providerId);
  }
  if (status === 429) {
    return new RateLimitError(providerId);
  }
  if (
    status === 413 ||
    normalizedMessage.includes('context length') ||
    normalizedMessage.includes('context_length') ||
    normalizedMessage.includes('too many tokens')
  ) {
    return new ContextTooLongError(providerId);
  }
  return new ProviderResponseError(providerId, undefined, status);
};

export const normalizeProviderError = (error: unknown, providerId: string): LlmError => {
  if (error instanceof LlmError) {
    return error;
  }
  if (isAbortError(error)) {
    return new CancelledError(providerId, error);
  }
  if (error instanceof TypeError) {
    return new NetworkError(providerId, error);
  }

  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
      ? error.status
      : undefined;
  if (status !== undefined) {
    const message = error instanceof Error ? error.message : '';
    return errorFromHttpStatus(status, providerId, message);
  }
  return new ProviderResponseError(providerId, error);
};

export const toPublicLlmError = (error: unknown, providerId: string): PublicLlmError => {
  const normalized = normalizeProviderError(error, providerId);
  return {
    code: normalized.code,
    message: normalized.message,
    retryable: normalized.retryable,
  };
};
