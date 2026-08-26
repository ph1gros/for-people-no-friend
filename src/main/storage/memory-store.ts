import { randomUUID } from 'node:crypto';

import type { MemoryCandidate, MemoryRecord, MemoryType } from '../../core/memory/contracts';
import { normalizeMemoryKey, sanitizeMemoryCandidate } from '../../core/memory/memory-policy';
import { DeskpetDatabase } from './deskpet-database';

interface MemoryRow {
  id: string;
  namespace: string;
  type: MemoryType;
  normalized_key: string;
  content: string;
  importance: number;
  confidence: number;
  source_message_id: string | null;
  source: 'manual' | 'automatic';
  created_at: number;
  updated_at: number;
  last_confirmed_at: number | null;
  last_used_at: number | null;
  expires_at: number | null;
  status: MemoryRecord['status'];
  source_excerpt?: string | null;
}

const rowToMemory = (row: MemoryRow): MemoryRecord => ({
  id: row.id,
  namespace: row.namespace,
  type: row.type,
  normalizedKey: row.normalized_key,
  content: row.content,
  importance: row.importance,
  confidence: row.confidence,
  status: row.status,
  source: row.source,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.source_message_id ? { sourceMessageId: row.source_message_id } : {}),
  ...(row.last_confirmed_at ? { lastConfirmedAt: row.last_confirmed_at } : {}),
  ...(row.last_used_at ? { lastUsedAt: row.last_used_at } : {}),
  ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
  ...(row.source_excerpt ? { sourceExcerpt: row.source_excerpt.slice(0, 240) } : {}),
});

const keywordParts = (query: string): string[] => {
  const normalized = query.normalize('NFKC').toLocaleLowerCase();
  const words = normalized.match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const parts = new Set(words.slice(0, 12));
  for (const word of words) {
    if (/^[\p{Script=Han}]+$/u.test(word) && word.length > 2) {
      for (let index = 0; index < word.length - 1 && parts.size < 20; index += 1) {
        parts.add(word.slice(index, index + 2));
      }
    }
  }
  return [...parts];
};

export class MemoryStore {
  public constructor(private readonly database: DeskpetDatabase) {}

  public list(namespace: string, type?: MemoryType, limit = 500): MemoryRecord[] {
    this.expire(namespace);
    const rows = this.database.connection
      .prepare(
        `SELECT memories.*, messages.content AS source_excerpt
           FROM memories
           LEFT JOIN messages ON messages.id = memories.source_message_id
          WHERE namespace = ? AND memories.status = 'active'
            AND (? IS NULL OR memories.type = ?)
          ORDER BY memories.updated_at DESC
          LIMIT ?`,
      )
      .all(
        namespace,
        type ?? null,
        type ?? null,
        Math.max(1, Math.min(limit, 500)),
      ) as unknown as MemoryRow[];
    return rows.map(rowToMemory);
  }

  public save(
    namespace: string,
    candidateValue: MemoryCandidate,
    source: 'manual' | 'automatic',
    sourceMessageId?: string,
  ): MemoryRecord | undefined {
    const candidate = sanitizeMemoryCandidate(candidateValue, source);
    if (!candidate) {
      return undefined;
    }
    this.expire(namespace);
    const existing = this.database.connection
      .prepare(
        `SELECT memories.*, NULL AS source_excerpt
           FROM memories
          WHERE namespace = ? AND normalized_key = ? AND status = 'active'
          ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(namespace, candidate.normalizedKey) as unknown as MemoryRow | undefined;
    const now = Date.now();
    if (existing && existing.content === candidate.content) {
      this.database.connection
        .prepare(
          `UPDATE memories
              SET importance = MAX(importance, ?),
                  confidence = MAX(confidence, ?),
                  updated_at = ?,
                  last_confirmed_at = ?,
                  source_message_id = COALESCE(?, source_message_id),
                  source = CASE WHEN ? = 'manual' THEN 'manual' ELSE source END
            WHERE id = ?`,
        )
        .run(
          candidate.importance,
          candidate.confidence,
          now,
          now,
          sourceMessageId ?? null,
          source,
          existing.id,
        );
      return this.get(namespace, existing.id);
    }
    if (
      existing &&
      source === 'automatic' &&
      (existing.source === 'manual' || candidate.confidence < existing.confidence)
    ) {
      return undefined;
    }
    const id = randomUUID();
    this.database.connection.exec('BEGIN IMMEDIATE');
    try {
      if (existing) {
        this.database.connection
          .prepare(`UPDATE memories SET status = 'superseded', updated_at = ? WHERE id = ?`)
          .run(now, existing.id);
        this.database.connection.prepare('DELETE FROM memories_fts WHERE id = ?').run(existing.id);
      }
      this.database.connection
        .prepare(
          `INSERT INTO memories (
            id, namespace, type, normalized_key, content, importance, confidence,
            source_message_id, source, created_at, updated_at, last_confirmed_at,
            last_used_at, expires_at, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'active')`,
        )
        .run(
          id,
          namespace,
          candidate.type,
          candidate.normalizedKey,
          candidate.content,
          candidate.importance,
          candidate.confidence,
          sourceMessageId ?? null,
          source,
          now,
          now,
          source === 'manual' ? now : null,
          candidate.expiresAt ?? null,
        );
      this.database.connection
        .prepare(
          'INSERT INTO memories_fts (id, namespace, normalized_key, content) VALUES (?, ?, ?, ?)',
        )
        .run(id, namespace, candidate.normalizedKey, candidate.content);
      this.database.connection.exec('COMMIT');
      return this.get(namespace, id);
    } catch (error) {
      this.database.connection.exec('ROLLBACK');
      throw error;
    }
  }

  public update(namespace: string, id: string, value: MemoryCandidate): MemoryRecord | undefined {
    const candidate = sanitizeMemoryCandidate(value, 'manual');
    if (!candidate || !this.get(namespace, id)) {
      return undefined;
    }
    const now = Date.now();
    this.database.connection.exec('BEGIN IMMEDIATE');
    try {
      const conflicts = this.database.connection
        .prepare(
          `SELECT id FROM memories
            WHERE namespace = ? AND normalized_key = ? AND status = 'active' AND id <> ?`,
        )
        .all(namespace, candidate.normalizedKey, id) as unknown as { id: string }[];
      for (const conflict of conflicts) {
        this.database.connection
          .prepare(`UPDATE memories SET status = 'superseded', updated_at = ? WHERE id = ?`)
          .run(now, conflict.id);
        this.database.connection.prepare('DELETE FROM memories_fts WHERE id = ?').run(conflict.id);
      }
      this.database.connection
        .prepare(
          `UPDATE memories SET
            type = ?, normalized_key = ?, content = ?, importance = ?, confidence = ?,
            source = 'manual', updated_at = ?, last_confirmed_at = ?, expires_at = ?
            WHERE id = ? AND namespace = ? AND status = 'active'`,
        )
        .run(
          candidate.type,
          candidate.normalizedKey,
          candidate.content,
          candidate.importance,
          candidate.confidence,
          now,
          now,
          candidate.expiresAt ?? null,
          id,
          namespace,
        );
      this.database.connection.prepare('DELETE FROM memories_fts WHERE id = ?').run(id);
      this.database.connection
        .prepare(
          'INSERT INTO memories_fts (id, namespace, normalized_key, content) VALUES (?, ?, ?, ?)',
        )
        .run(id, namespace, candidate.normalizedKey, candidate.content);
      this.database.connection.exec('COMMIT');
      return this.get(namespace, id);
    } catch (error) {
      this.database.connection.exec('ROLLBACK');
      throw error;
    }
  }

  public delete(namespace: string, id: string): boolean {
    return this.scrub(namespace, [id]) > 0;
  }

  public forget(namespace: string, query: string): number {
    const normalized = normalizeMemoryKey(query);
    if (!normalized) {
      return 0;
    }
    const rows = this.database.connection
      .prepare(
        `SELECT memories.*, NULL AS source_excerpt FROM memories
          WHERE namespace = ? AND status <> 'deleted'`,
      )
      .all(namespace) as unknown as MemoryRow[];
    const matches = rows.map(rowToMemory).filter((memory) => {
      const searchable = normalizeMemoryKey(`${memory.normalizedKey} ${memory.content}`);
      return (
        searchable.includes(normalized) || normalized.includes(normalizeMemoryKey(memory.content))
      );
    });
    return this.scrub(
      namespace,
      matches.map((memory) => memory.id),
    );
  }

  public clear(namespace: string): number {
    const rows = this.database.connection
      .prepare(`SELECT id FROM memories WHERE namespace = ? AND status <> 'deleted'`)
      .all(namespace) as unknown as { id: string }[];
    return this.scrub(
      namespace,
      rows.map((row) => row.id),
    );
  }

  public retrieve(namespace: string, query: string, limit = 5): MemoryRecord[] {
    const memories = this.list(namespace, undefined, 300);
    const terms = keywordParts(query);
    if (terms.length === 0) {
      return [];
    }
    const now = Date.now();
    const scored = memories
      .map((memory) => {
        const searchable = `${memory.normalizedKey} ${memory.content}`.toLocaleLowerCase();
        const hits = terms.filter((term) => searchable.includes(term)).length;
        if (hits === 0) {
          return { memory, score: 0 };
        }
        const keywordScore = Math.min(1, hits / Math.min(4, terms.length));
        const confirmedAt = memory.lastConfirmedAt ?? memory.updatedAt;
        const recency = Math.max(0, 1 - (now - confirmedAt) / (365 * 24 * 60 * 60 * 1_000));
        const lastUsed = memory.lastUsedAt
          ? Math.max(0, 1 - (now - memory.lastUsedAt) / (90 * 24 * 60 * 60 * 1_000))
          : 0;
        return {
          memory,
          score: keywordScore * 0.5 + memory.importance * 0.25 + recency * 0.15 + lastUsed * 0.1,
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Math.min(limit, 8)));
    const usedAt = Date.now();
    for (const entry of scored) {
      this.database.connection
        .prepare('UPDATE memories SET last_used_at = ? WHERE id = ?')
        .run(usedAt, entry.memory.id);
    }
    return scored.map((entry) => ({ ...entry.memory, lastUsedAt: usedAt }));
  }

  public get(namespace: string, id: string): MemoryRecord | undefined {
    const row = this.database.connection
      .prepare(
        `SELECT memories.*, messages.content AS source_excerpt
           FROM memories
           LEFT JOIN messages ON messages.id = memories.source_message_id
          WHERE memories.id = ? AND namespace = ?`,
      )
      .get(id, namespace) as unknown as MemoryRow | undefined;
    return row ? rowToMemory(row) : undefined;
  }

  private expire(namespace: string): void {
    const expired = this.database.connection
      .prepare(
        `SELECT id FROM memories
          WHERE namespace = ? AND status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`,
      )
      .all(namespace, Date.now()) as unknown as { id: string }[];
    if (expired.length === 0) {
      return;
    }
    this.database.connection
      .prepare(
        `UPDATE memories SET status = 'superseded', updated_at = ?
          WHERE namespace = ? AND status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`,
      )
      .run(Date.now(), namespace, Date.now());
    for (const memory of expired) {
      this.database.connection.prepare('DELETE FROM memories_fts WHERE id = ?').run(memory.id);
    }
  }

  private scrub(namespace: string, ids: string[]): number {
    if (ids.length === 0) {
      return 0;
    }
    const now = Date.now();
    let changed = 0;
    this.database.connection.exec('BEGIN IMMEDIATE');
    try {
      for (const id of ids) {
        const result = this.database.connection
          .prepare(
            `UPDATE memories SET
              normalized_key = ?, content = '', source_message_id = NULL,
              status = 'deleted', updated_at = ?, last_confirmed_at = NULL,
              last_used_at = NULL, expires_at = NULL
              WHERE id = ? AND namespace = ? AND status <> 'deleted'`,
          )
          .run(`deleted:${id}`, now, id, namespace);
        changed += Number(result.changes);
        this.database.connection.prepare('DELETE FROM memories_fts WHERE id = ?').run(id);
      }
      this.database.connection.exec('COMMIT');
      return changed;
    } catch (error) {
      this.database.connection.exec('ROLLBACK');
      throw error;
    }
  }
}
