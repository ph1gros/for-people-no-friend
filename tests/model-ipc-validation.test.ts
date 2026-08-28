import { describe, expect, it } from 'vitest';

import {
  parseCancelProviderRequestInput,
  parseProviderConfiguration,
  parseSetProviderSecretInput,
  parseTestProviderConnectionInput,
} from '../src/shared/model-ipc';

describe('model IPC validation', () => {
  it('accepts bounded provider inputs', () => {
    expect(
      parseTestProviderConnectionInput({
        requestId: 'request_1',
        providerId: 'anthropic',
        modelId: 'fake-claude',
      }),
    ).toEqual({
      requestId: 'request_1',
      providerId: 'anthropic',
      modelId: 'fake-claude',
    });
    expect(
      parseProviderConfiguration({
        openAICompatibleBaseUrl: 'http://127.0.0.1:11434/v1',
      }),
    ).toEqual({
      openAICompatibleBaseUrl: 'http://127.0.0.1:11434/v1',
    });
    expect(parseSetProviderSecretInput({ providerId: 'deepseek', apiKey: 'fake-key' })).toEqual({
      providerId: 'deepseek',
      apiKey: 'fake-key',
    });
  });

  it('rejects unknown providers, masked secrets and malformed cancellation IDs', () => {
    expect(() =>
      parseSetProviderSecretInput({ providerId: 'unknown', apiKey: 'fake-key' }),
    ).toThrow();
    expect(() =>
      parseSetProviderSecretInput({ providerId: 'anthropic', apiKey: '********' }),
    ).toThrow();
    expect(() => parseCancelProviderRequestInput({ requestId: '../bad' })).toThrow();
  });
});
