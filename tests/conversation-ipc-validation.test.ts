import { describe, expect, it } from 'vitest';

import {
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
    ).toEqual({
      requestId: 'chat_1',
      message: '你好',
      availableActions: ['wave'],
      assistantMode: false,
      wakeFromDrowsy: false,
    });
    expect(
      parseStartConversationInput({
        requestId: 'chat_wake',
        message: '醒醒',
        availableActions: [],
        wakeFromDrowsy: true,
      }),
    ).toMatchObject({ wakeFromDrowsy: true });
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
      parseStartConversationInput({
        requestId: 'chat_1',
        message: 'hello',
        availableActions: [],
        assistantMode: 'yes',
      }),
    ).toThrow();
    expect(() =>
      parseStartConversationInput({
        requestId: 'chat_1',
        message: 'hello',
        availableActions: [],
        wakeFromDrowsy: 'yes',
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
    expect(
      parseConversationEvent({
        requestId: 'chat_1',
        type: 'tool-approval',
        approvalId: 'write_1',
        title: '写入？',
        description: 'code.ts',
      }),
    ).toMatchObject({ type: 'tool-approval', approvalId: 'write_1' });
  });
});
