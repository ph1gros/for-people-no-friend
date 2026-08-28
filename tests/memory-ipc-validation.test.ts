import { describe, expect, it } from 'vitest';

import {
  parseConfirmMemoryCandidateInput,
  parseMergeMemoryCandidatesInput,
  parseMemoryIdInput,
  parseSetMemorySettingsInput,
  parseUpdateMemoryCandidateInput,
  parseUpdateMemoryInput,
} from '../src/shared/memory-ipc';

describe('M5 memory IPC validation', () => {
  it('accepts bounded settings and edits', () => {
    expect(parseSetMemorySettingsInput({ automaticMemoryEnabled: true })).toEqual({
      automaticMemoryEnabled: true,
      semanticIndex: 'local',
      relationshipIndex: 'local',
      qdrantUrl: 'http://127.0.0.1:6333',
      qdrantCollection: 'deskpet_memories',
      neo4jUrl: 'http://127.0.0.1:7474',
      neo4jDatabase: 'neo4j',
      neo4jUsername: 'neo4j',
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
    expect(parseConfirmMemoryCandidateInput({ id: 'candidate-id' })).toEqual({
      id: 'candidate-id',
      conflictResolution: 'replace',
    });
    expect(
      parseConfirmMemoryCandidateInput({
        id: 'candidate-id',
        conflictResolution: 'keep-both',
      }),
    ).toEqual({ id: 'candidate-id', conflictResolution: 'keep-both' });
    expect(
      parseMergeMemoryCandidatesInput({ targetId: 'candidate-a', sourceId: 'candidate-b' }),
    ).toEqual({ targetId: 'candidate-a', sourceId: 'candidate-b' });
    expect(
      parseUpdateMemoryCandidateInput({
        id: 'candidate-id',
        type: 'plan',
        content: '用户计划周末散步',
        importance: 0.7,
        confidence: 0.8,
        expiresAt: Date.now() + 60_000,
      }),
    ).toEqual(expect.objectContaining({ id: 'candidate-id' }));
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
    expect(() =>
      parseConfirmMemoryCandidateInput({ id: 'candidate-id', conflictResolution: 'erase-old' }),
    ).toThrow();
    expect(() =>
      parseMergeMemoryCandidatesInput({ targetId: 'same-id', sourceId: 'same-id' }),
    ).toThrow();
  });
});
