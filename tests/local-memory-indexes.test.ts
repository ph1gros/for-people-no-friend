import { describe, expect, it } from 'vitest';

import type { MemoryRecord } from '../src/core/memory/contracts';
import {
  LocalEmbeddingMemoryIndex,
  LocalRelationshipMemoryIndex,
} from '../src/main/memory/local-memory-indexes';

const record = (id: string, type: MemoryRecord['type'], content: string): MemoryRecord => ({
  id,
  namespace: 'role-a',
  type,
  normalizedKey: id,
  content,
  importance: 0.8,
  confidence: 1,
  status: 'active',
  source: 'manual',
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

describe('local optional memory indexes', () => {
  const records = [
    record('alice', 'person', '小爱丽丝是用户的妹妹，喜欢天文'),
    record('telescope', 'event', '用户答应周末陪小爱丽丝看星星'),
    record('unrelated', 'preference', '用户喜欢辣味拉面'),
  ];

  it('produces bounded local embeddings without sending text away', async () => {
    const result = await new LocalEmbeddingMemoryIndex(records).search(
      'role-a',
      '周末和爱丽丝看星星',
      3,
    );
    expect(result[0]?.memoryId).toBe('telescope');
    expect(result.every(({ score }) => score >= 0 && score <= 1)).toBe(true);
  });

  it('finds a related event through a shared person node', async () => {
    const result = await new LocalRelationshipMemoryIndex(records).search(
      'role-a',
      '爱丽丝是谁',
      5,
    );
    expect(result.map(({ memoryId }) => memoryId)).toContain('telescope');
  });
});
