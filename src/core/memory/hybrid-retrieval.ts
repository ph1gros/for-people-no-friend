import type { MemoryRecord } from './contracts';

export interface IndexedMemoryMatch {
  memoryId: string;
  score: number;
  reason: 'semantic' | 'relationship';
}

export interface SemanticMemoryIndex {
  readonly kind: 'embedding' | 'vector-database';
  search(namespace: string, query: string, limit: number): Promise<IndexedMemoryMatch[]>;
}

export interface RelationshipMemoryIndex {
  readonly kind: 'graph';
  search(namespace: string, query: string, limit: number): Promise<IndexedMemoryMatch[]>;
}

export interface HybridMemoryMatch {
  record: MemoryRecord;
  score: number;
  reasons: Array<'keyword' | 'semantic' | 'relationship' | 'importance' | 'recent'>;
}

const validIndexMatches = (
  matches: readonly IndexedMemoryMatch[],
  reason: IndexedMemoryMatch['reason'],
): IndexedMemoryMatch[] =>
  matches.filter(
    (match) =>
      match.reason === reason &&
      typeof match.memoryId === 'string' &&
      match.memoryId.length > 0 &&
      Number.isFinite(match.score) &&
      match.score >= 0 &&
      match.score <= 1,
  );

export const retrieveHybridMemories = async (input: {
  namespace: string;
  keywordMatches: readonly MemoryRecord[];
  candidateRecords?: readonly MemoryRecord[];
  semanticIndex?: SemanticMemoryIndex;
  relationshipIndex?: RelationshipMemoryIndex;
  query: string;
  limit?: number;
}): Promise<HybridMemoryMatch[]> => {
  const limit = Math.max(1, Math.min(8, Math.trunc(input.limit ?? 5)));
  const records = new Map(
    (input.candidateRecords ?? input.keywordMatches)
      .filter((record) => record.namespace === input.namespace && record.status === 'active')
      .map((record) => [record.id, record]),
  );
  const scores = new Map<
    string,
    { score: number; reasons: Set<HybridMemoryMatch['reasons'][number]> }
  >();
  input.keywordMatches.forEach((record, index) => {
    if (!records.has(record.id)) return;
    scores.set(record.id, { score: 1 / (60 + index + 1), reasons: new Set(['keyword']) });
  });
  const merge = (matches: readonly IndexedMemoryMatch[], reason: 'semantic' | 'relationship') => {
    validIndexMatches(matches, reason).forEach((match, index) => {
      if (!records.has(match.memoryId)) return;
      const current = scores.get(match.memoryId) ?? { score: 0, reasons: new Set() };
      current.score += match.score / (60 + index + 1);
      current.reasons.add(reason);
      scores.set(match.memoryId, current);
    });
  };

  await Promise.all([
    input.semanticIndex
      ?.search(input.namespace, input.query, limit)
      .then((matches) => merge(matches, 'semantic'))
      .catch(() => undefined),
    input.relationshipIndex
      ?.search(input.namespace, input.query, limit)
      .then((matches) => merge(matches, 'relationship'))
      .catch(() => undefined),
  ]);

  const now = Date.now();
  for (const [id, current] of scores) {
    const record = records.get(id)!;
    if (record.importance >= 0.7) {
      current.score += record.importance * 0.004;
      current.reasons.add('importance');
    }
    const referenceTime = record.lastConfirmedAt ?? record.updatedAt;
    const recent = Math.max(0, 1 - (now - referenceTime) / (365 * 24 * 60 * 60 * 1_000));
    if (recent > 0.5) {
      current.score += recent * 0.003;
      current.reasons.add('recent');
    }
  }

  return [...scores.entries()]
    .map(([id, value]) => ({
      record: records.get(id)!,
      score: value.score,
      reasons: [...value.reasons],
    }))
    .sort(
      (left, right) => right.score - left.score || left.record.id.localeCompare(right.record.id),
    )
    .slice(0, limit);
};
