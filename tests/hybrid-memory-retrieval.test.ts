import { describe, expect, it } from 'vitest';

import type { MemoryRecord } from '../src/core/memory/contracts';
import { retrieveHybridMemories } from '../src/core/memory/hybrid-retrieval';

const memory = (id: string, namespace = 'character-a'): MemoryRecord => ({
  id,
  namespace,
  type: 'fact',
  normalizedKey: id,
  content: id,
  importance: 0.8,
  confidence: 0.9,
  status: 'active',
  source: 'manual',
  createdAt: 1,
  updatedAt: 1,
});

describe('hybrid memory retrieval', () => {
  it('fuses optional semantic and relationship reasons without crossing namespaces', async () => {
    const first = memory('first');
    const second = memory('second');
    const result = await retrieveHybridMemories({
      namespace: 'character-a',
      query: '换一种说法',
      keywordMatches: [first, second, memory('foreign', 'character-b')],
      semanticIndex: {
        kind: 'embedding',
        search: async () => [{ memoryId: 'second', score: 1, reason: 'semantic' }],
      },
      relationshipIndex: {
        kind: 'graph',
        search: async () => [{ memoryId: 'first', score: 0.5, reason: 'relationship' }],
      },
    });

    expect(new Set(result.map(({ record }) => record.id))).toEqual(new Set(['first', 'second']));
    expect(result.find(({ record }) => record.id === 'first')?.reasons).toEqual([
      'keyword',
      'relationship',
      'importance',
    ]);
    expect(result.find(({ record }) => record.id === 'second')?.reasons).toEqual([
      'keyword',
      'semantic',
      'importance',
    ]);
  });

  it('degrades to keyword results when optional indexes fail', async () => {
    const result = await retrieveHybridMemories({
      namespace: 'character-a',
      query: 'anything',
      keywordMatches: [memory('safe')],
      semanticIndex: {
        kind: 'vector-database',
        search: async () => Promise.reject(new Error('offline')),
      },
    });
    expect(result[0]?.record.id).toBe('safe');
    expect(result[0]?.reasons).toEqual(['keyword', 'importance']);
  });
});
