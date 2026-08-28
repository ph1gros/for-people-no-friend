import type { MemoryRecord } from '../../core/memory/contracts';
import type {
  IndexedMemoryMatch,
  RelationshipMemoryIndex,
  SemanticMemoryIndex,
} from '../../core/memory/hybrid-retrieval';

const VECTOR_SIZE = 256;

const hash = (value: string): number => {
  let result = 2_166_136_261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
};

const terms = (text: string): string[] => {
  const normalized = text.normalize('NFKC').toLocaleLowerCase();
  const result = new Set(normalized.match(/[\p{L}\p{N}]{2,}/gu) ?? []);
  for (const word of [...result]) {
    if (/^[\p{Script=Han}]+$/u.test(word)) {
      for (let index = 0; index < word.length - 1; index += 1) {
        result.add(word.slice(index, index + 2));
      }
    }
  }
  return [...result].slice(0, 128);
};

export const createLocalTextEmbedding = (text: string): Float32Array => {
  const vector = new Float32Array(VECTOR_SIZE);
  for (const term of terms(text)) {
    const value = hash(term);
    vector[value % VECTOR_SIZE] += (value & 0x100) === 0 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((total, item) => total + item * item, 0));
  if (norm > 0) vector.forEach((value, index) => (vector[index] = value / norm));
  return vector;
};

const similarity = (left: Float32Array, right: Float32Array): number => {
  let score = 0;
  for (let index = 0; index < VECTOR_SIZE; index += 1) score += left[index]! * right[index]!;
  return Math.max(0, Math.min(1, score));
};

export class LocalEmbeddingMemoryIndex implements SemanticMemoryIndex {
  public readonly kind = 'embedding' as const;

  public constructor(private readonly records: readonly MemoryRecord[]) {}

  public async search(
    namespace: string,
    query: string,
    limit: number,
  ): Promise<IndexedMemoryMatch[]> {
    const queryVector = createLocalTextEmbedding(query);
    return this.records
      .filter((record) => record.namespace === namespace && record.status === 'active')
      .map((record) => ({
        memoryId: record.id,
        score: similarity(
          queryVector,
          createLocalTextEmbedding(`${record.normalizedKey} ${record.content}`),
        ),
        reason: 'semantic' as const,
      }))
      .filter(({ score }) => score >= 0.08)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }
}

export class LocalRelationshipMemoryIndex implements RelationshipMemoryIndex {
  public readonly kind = 'graph' as const;

  public constructor(private readonly records: readonly MemoryRecord[]) {}

  public async search(
    namespace: string,
    query: string,
    limit: number,
  ): Promise<IndexedMemoryMatch[]> {
    const records = this.records.filter(
      (record) => record.namespace === namespace && record.status === 'active',
    );
    const queryTerms = new Set(terms(query));
    const recordTerms = new Map(
      records.map((record) => [
        record.id,
        new Set(terms(`${record.normalizedKey} ${record.content}`)),
      ]),
    );
    const direct = records.filter((record) =>
      [...(recordTerms.get(record.id) ?? [])].some((term) => queryTerms.has(term)),
    );
    const scores = new Map<string, number>();
    for (const source of direct) {
      if (source.type === 'person') scores.set(source.id, 0.9);
      const sourceTerms = recordTerms.get(source.id) ?? new Set();
      for (const candidate of records) {
        if (candidate.id === source.id) continue;
        const shared = [...(recordTerms.get(candidate.id) ?? [])].filter((term) =>
          sourceTerms.has(term),
        ).length;
        if (shared > 0) scores.set(candidate.id, Math.max(scores.get(candidate.id) ?? 0, 0.55));
      }
    }
    return [...scores]
      .map(([memoryId, score]) => ({ memoryId, score, reason: 'relationship' as const }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }
}
