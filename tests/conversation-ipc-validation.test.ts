import { describe, expect, it } from 'vitest';

import {
  parseCharacterProfileIdInput,
  parseConversationConfiguration,
  parseConversationEvent,
  parseStartConversationInput,
} from '../src/shared/conversation-ipc';

describe('conversation IPC validation', () => {
  it('accepts bounded chat inputs and removes duplicate action IDs', () => {
    expect(
      parseStartConversationInput({
        requestId: 'chat_1',
        message: ' 你好 ',
        availableActions: ['wave', 'wave'],
      }),
    ).toEqual({ requestId: 'chat_1', message: '你好', availableActions: ['wave'] });
    expect(
      parseConversationConfiguration({
        selection: { providerId: 'openai-compatible', modelId: ' local-model ' },
      }),
    ).toEqual({ selection: { providerId: 'openai-compatible', modelId: 'local-model' } });
  });

  it('rejects oversized messages, unknown providers and unsafe action names', () => {
    expect(() =>
      parseStartConversationInput({
        requestId: 'chat_1',
        message: 'x'.repeat(8_001),
        availableActions: [],
      }),
    ).toThrow();
    expect(() =>
      parseConversationConfiguration({ selection: { providerId: 'unknown', modelId: 'model' } }),
    ).toThrow();
    expect(() =>
      parseStartConversationInput({
        requestId: 'chat_1',
        message: 'hello',
        availableActions: ['../bad'],
      }),
    ).toThrow();
  });

  it('drops malformed Main-to-Renderer events', () => {
    expect(parseConversationEvent({ requestId: '../bad', type: 'text-delta', text: 'x' })).toBe(
      undefined,
    );
    expect(parseConversationEvent({ requestId: 'chat_1', type: 'text-delta', text: 'x' })).toEqual({
      requestId: 'chat_1',
      type: 'text-delta',
      text: 'x',
    });
  });

  it('accepts only bounded character profile identifiers', () => {
    expect(parseCharacterProfileIdInput({ id: 'irena' })).toEqual({ id: 'irena' });
    expect(() => parseCharacterProfileIdInput({ id: '../irena' })).toThrow();
    expect(() => parseCharacterProfileIdInput({ id: '伊雷娜' })).toThrow();
  });
});
