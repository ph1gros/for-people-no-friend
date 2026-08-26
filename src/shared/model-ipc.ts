import type { ConnectionResult, ProviderCapability } from '../core/llm/contracts';

export type ConfigurableProviderId = 'anthropic' | 'openai-compatible';

export interface ProviderSummary {
  id: string;
  displayName: string;
  capabilities: ProviderCapability[];
}

export interface ProviderConfiguration {
  openAICompatibleBaseUrl: string;
}

export interface ProviderSecretStatus {
  anthropic: boolean;
  'openai-compatible': boolean;
}

export interface SetProviderSecretInput {
  providerId: ConfigurableProviderId;
  apiKey: string;
}

export interface DeleteProviderSecretInput {
  providerId: ConfigurableProviderId;
}

export interface TestProviderConnectionInput {
  requestId: string;
  providerId: ConfigurableProviderId;
  modelId: string;
}

export interface CancelProviderRequestInput {
  requestId: string;
}

export type ModelOperationResult =
  { ok: true } | { ok: false; error: { code: string; message: string; retryable: boolean } };

export type TestProviderConnectionResult = ConnectionResult;

const PROVIDER_IDS = new Set<ConfigurableProviderId>(['anthropic', 'openai-compatible']);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const parseProviderId = (value: unknown): ConfigurableProviderId => {
  if (typeof value !== 'string' || !PROVIDER_IDS.has(value as ConfigurableProviderId)) {
    throw new Error('The provider ID is invalid.');
  }
  return value as ConfigurableProviderId;
};

export const parseSetProviderSecretInput = (value: unknown): SetProviderSecretInput => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The secret update is invalid.');
  }
  const providerId = parseProviderId('providerId' in value ? value.providerId : undefined);
  const apiKey = 'apiKey' in value ? value.apiKey : undefined;
  if (
    typeof apiKey !== 'string' ||
    apiKey.trim().length === 0 ||
    apiKey.length > 32_768 ||
    /^\*+$/.test(apiKey.trim())
  ) {
    throw new Error('A non-empty, unmasked API key is required.');
  }
  return { providerId, apiKey };
};

export const parseDeleteProviderSecretInput = (value: unknown): DeleteProviderSecretInput => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The secret deletion request is invalid.');
  }
  return {
    providerId: parseProviderId('providerId' in value ? value.providerId : undefined),
  };
};

export const parseProviderConfiguration = (value: unknown): ProviderConfiguration => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The provider configuration is invalid.');
  }
  const baseUrl = 'openAICompatibleBaseUrl' in value ? value.openAICompatibleBaseUrl : undefined;
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0 || baseUrl.length > 2_048) {
    throw new Error('The OpenAI-compatible base URL is invalid.');
  }
  return { openAICompatibleBaseUrl: baseUrl.trim() };
};

export const parseTestProviderConnectionInput = (value: unknown): TestProviderConnectionInput => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The connection test request is invalid.');
  }
  const requestId = 'requestId' in value ? value.requestId : undefined;
  const modelId = 'modelId' in value ? value.modelId : undefined;
  if (
    typeof requestId !== 'string' ||
    !REQUEST_ID_PATTERN.test(requestId) ||
    typeof modelId !== 'string' ||
    modelId.trim().length === 0 ||
    modelId.length > 256
  ) {
    throw new Error('The connection test request is invalid.');
  }
  return {
    requestId,
    providerId: parseProviderId('providerId' in value ? value.providerId : undefined),
    modelId: modelId.trim(),
  };
};

export const parseCancelProviderRequestInput = (value: unknown): CancelProviderRequestInput => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('requestId' in value) ||
    typeof value.requestId !== 'string' ||
    !REQUEST_ID_PATTERN.test(value.requestId)
  ) {
    throw new Error('The cancellation request is invalid.');
  }
  return { requestId: value.requestId };
};
