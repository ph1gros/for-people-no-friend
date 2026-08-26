import { describe, expect, it } from 'vitest';

import {
  parseMemoryIdInput,
  parseSetMemorySettingsInput,
  parseUpdateMemoryInput,
} from '../src/shared/memory-ipc';

describe('M5 memory IPC validation', () => {
  it('accepts bounded settings and edits', () => {
    expect(parseSetMemorySettingsInput({ automaticMemoryEnabled: true })).toEqual({
      automaticMemoryEnabled: true,
    });
    expect(
      parseUpdateMemoryInput({
        id: 'memory-id',
        type: 'preference',
        content: ' 用户喜欢蓝色 ',
        importance: 0.8,
        confidence: 0.9,
      }),
    ).toEqual({
      id: 'memory-id',
      candidate: expect.objectContaining({
        type: 'preference',
        content: '用户喜欢蓝色',
        importance: 0.8,
        confidence: 0.9,
      }),
    });
  });

  it('rejects unsafe IDs, types, sizes and scores', () => {
    expect(() => parseMemoryIdInput({ id: '../memory' })).toThrow();
    expect(() =>
      parseUpdateMemoryInput({
        id: 'memory-id',
        type: 'secret',
        content: 'x',
        importance: 1,
        confidence: 1,
      }),
    ).toThrow();
    expect(() =>
      parseUpdateMemoryInput({
        id: 'memory-id',
        type: 'fact',
        content: 'x'.repeat(1_001),
        importance: 1.1,
        confidence: 1,
      }),
    ).toThrow();
  });
});
