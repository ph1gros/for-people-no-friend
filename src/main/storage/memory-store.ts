import { createHash, randomUUID } from 'node:crypto';

import {
  MEMORY_REVIEW_REASONS,
  type MemoryCandidate,
  type MemoryCandidateRecord,
  type MemoryCandidateStatus,
  type MemoryEvidence,
  type MemoryRecord,
  type MemoryReviewReason,
  type MemoryType,
} from '../../core/memory/contracts';
import {
  memoryReviewReasons,
  normalizeMemoryKey,
  sanitizeMemoryCandidate,
} from '../../core/memory/memory-policy';
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

interface MemoryCandidateRow {
  id: string;
  namespace: string;
  type: MemoryType;
  normalized_key: string;
  content: string;
  importance: number;
  confidence: number;
  status: MemoryCandidateStatus;
  review_reasons_json: string;
  conflicting_memory_id: string | null;
  legacy_memory_id: string | null;
  created_at: number;
  updated_at: number;
  last_seen_at: number;
  expires_at: number | null;
  decision_at: number | null;
}

interface MemoryEvidenceRow {
  source_message_id: string;
  observed_at: number;
  source_excerpt: string | null;
}

interface MemoryEvidenceSource {
  id: string;
  createdAt: number;
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

const reviewReasonSet = new Set<string>(MEMORY_REVIEW_REASONS);

const parseReviewReasons = (value: string): MemoryReviewReason[] => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (reason): reason is MemoryReviewReason =>
            typeof reason === 'string' && reviewReasonSet.has(reason),
        )
      : [];
  } catch {
    return [];
  }
};

const rowToEvidence = (row: MemoryEvidenceRow): MemoryEvidence => ({
  sourceMessageId: row.source_message_id,
  observedAt: row.observed_at,
  ...(row.source_excerpt ? { sourceExcerpt: row.source_excerpt.slice(0, 240) } : {}),
});

const candidateFingerprint = (normalizedKey: string, content: string): string =>
  createHash('sha256').update(`${normalizedKey}\0${content}`).digest('hex');

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

  public listCandidates(namespace: string, limit = 200): MemoryCandidateRecord[] {
    const rows = this.database.connection
      .prepare(
        `SELECT * FROM memory_candidates
          WHERE namespace = ? AND status IN ('pending', 'conflict')
          ORDER BY updated_at DESC
          LIMIT ?`,
      )
      .all(namespace, Math.max(1, Math.min(limit, 200))) as unknown as MemoryCandidateRow[];
    return rows.map((row) => this.rowToCandidate(row));
  }

  public saveAutomaticCandidate(
    namespace: string,
    candidateValue: MemoryCandidate,
    evidence: MemoryEvidenceSource,
  ): MemoryCandidateRecord | undefined {
    const candidate = sanitizeMemoryCandidate(candidateValue, 'automatic');
    if (!candidate || !evidence.id || !Number.isFinite(evidence.createdAt)) {
      return undefined;
    }
    this.expire(namespace);
    const existingMemory = this.findActiveByKey(namespace, candidate.normalizedKey);
    if (existingMemory?.content === candidate.content && existingMemory.last_confirmed_at) {
      return undefined;
    }
    const existingCandidate = this.database.connection
      .prepare(
        `SELECT * FROM memory_candidates
          WHERE namespace = ? AND normalized_key = ? AND content = ?
            AND status IN ('pending', 'conflict')
          ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(namespace, candidate.normalizedKey, candidate.content) as
      (MemoryCandidateRow & Record<string, unknown>) | undefined;
    const rejected = this.database.connection
      .prepare(
        `SELECT id FROM memory_candidates
          WHERE namespace = ? AND normalized_key = ? AND status = 'rejected'
          LIMIT 1`,
      )
      .get(
        namespace,
        `rejected:${candidateFingerprint(candidate.normalizedKey, candidate.content)}`,
      );
    if (rejected) {
      return undefined;
    }
    const now = Date.now();
    if (existingCandidate) {
      this.database.connection.exec('BEGIN IMMEDIATE');
      try {
        this.database.connection
          .prepare(
            `UPDATE memory_candidates
                SET importance = MAX(importance, ?), confidence = MAX(confidence, ?),
                    updated_at = ?, last_seen_at = MAX(last_seen_at, ?)
              WHERE id = ? AND namespace = ?`,
          )
          .run(
            candidate.importance,
            candidate.confidence,
            now,
            evidence.createdAt,
            existingCandidate.id,
            namespace,
          );
        this.insertEvidence(existingCandidate.id, evidence);
        this.database.connection.exec('COMMIT');
      } catch (error) {
        this.database.connection.exec('ROLLBACK');
        throw error;
      }
      return this.getCandidate(namespace, existingCandidate.id);
    }

    const id = randomUUID();
    const conflictingMemoryId =
      existingMemory && existingMemory.content !== candidate.content
        ? existingMemory.id
        : undefined;
    const reasons = memoryReviewReasons(candidate);
    if (conflictingMemoryId) {
      reasons.unshift('conflict');
    }
    const status: MemoryCandidateStatus = conflictingMemoryId ? 'conflict' : 'pending';
    this.database.connection.exec('BEGIN IMMEDIATE');
    try {
      this.database.connection
        .prepare(
          `INSERT INTO memory_candidates (
            id, namespace, type, normalized_key, content, importance, confidence,
            status, review_reasons_json, conflicting_memory_id, legacy_memory_id,
            created_at, updated_at, last_seen_at, expires_at, decision_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL)`,
        )
        .run(
          id,
          namespace,
          candidate.type,
          candidate.normalizedKey,
          candidate.content,
          candidate.importance,
          candidate.confidence,
          status,
          JSON.stringify(reasons),
          conflictingMemoryId ?? null,
          now,
          now,
          evidence.createdAt,
          candidate.expiresAt ?? null,
        );
      this.insertEvidence(id, evidence);
      this.database.connection.exec('COMMIT');
      return this.getCandidate(namespace, id);
    } catch (error) {
      this.database.connection.exec('ROLLBACK');
      throw error;
    }
  }

  public confirmCandidate(namespace: string, id: string): MemoryRecord | undefined {
    const candidate = this.getCandidateRow(namespace, id);
    if (!candidate || !['pending', 'conflict'].includes(candidate.status)) {
      return undefined;
    }
    const now = Date.now();
    const existing = this.findActiveByKey(namespace, candidate.normalized_key);
    const evidence = this.latestEvidence(id);
    let memoryId = existing?.id;
    this.database.connection.exec('BEGIN IMMEDIATE');
    try {
      if (existing?.content === candidate.content) {
        this.database.connection
          .prepare(
            `UPDATE memories SET
              importance = MAX(importance, ?), confidence = MAX(confidence, ?),
              updated_at = ?, last_confirmed_at = ?,
              source_message_id = COALESCE(?, source_message_id)
             WHERE id = ? AND namespace = ? AND status = 'active'`,
          )
          .run(
            candidate.importance,
            candidate.confidence,
            now,
            now,
            evidence?.source_message_id ?? null,
            existing.id,
            namespace,
          );
      } else {
        if (existing) {
          this.database.connection
            .prepare(`UPDATE memories SET status = 'superseded', updated_at = ? WHERE id = ?`)
            .run(now, existing.id);
          this.database.connection
            .prepare('DELETE FROM memories_fts WHERE id = ?')
            .run(existing.id);
        }
        memoryId = randomUUID();
        this.database.connection
          .prepare(
            `INSERT INTO memories (
              id, namespace, type, normalized_key, content, importance, confidence,
              source_message_id, source, created_at, updated_at, last_confirmed_at,
              last_used_at, expires_at, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'automatic', ?, ?, ?, NULL, ?, 'active')`,
          )
          .run(
            memoryId,
            namespace,
            candidate.type,
            candidate.normalized_key,
            candidate.content,
            candidate.importance,
            candidate.confidence,
            evidence?.source_message_id ?? null,
            now,
            now,
            now,
            candidate.expires_at,
          );
        this.database.connection
          .prepare(
            'INSERT INTO memories_fts (id, namespace, normalized_key, content) VALUES (?, ?, ?, ?)',
          )
          .run(memoryId, namespace, candidate.normalized_key, candidate.content);
      }
      this.database.connection
        .prepare(
          `UPDATE memory_candidates SET status = 'confirmed', updated_at = ?, decision_at = ?
            WHERE id = ? AND namespace = ?`,
        )
        .run(now, now, id, namespace);
      this.database.connection.exec('COMMIT');
      return memoryId ? this.get(namespace, memoryId) : undefined;
    } catch (error) {
      this.database.connection.exec('ROLLBACK');
      throw error;
    }
  }

  public rejectCandidate(namespace: string, id: string): boolean {
    const candidate = this.getCandidateRow(namespace, id);
    if (!candidate || !['pending', 'conflict'].includes(candidate.status)) {
      return false;
    }
    const now = Date.now();
    this.database.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = this.database.connection
        .prepare(
          `UPDATE memory_candidates SET
            normalized_key = ?, content = '', status = 'rejected',
            review_reasons_json = '[]', conflicting_memory_id = NULL,
            legacy_memory_id = NULL, updated_at = ?, decision_at = ?
            WHERE id = ? AND namespace = ? AND status IN ('pending', 'conflict')`,
        )
        .run(
          `rejected:${candidateFingerprint(candidate.normalized_key, candidate.content)}`,
          now,
          now,
          id,
          namespace,
        );
      if (candidate.legacy_memory_id) {
        this.database.connection
          .prepare(
            `UPDATE memories SET
              normalized_key = ?, content = '', source_message_id = NULL,
              status = 'deleted', updated_at = ?, last_confirmed_at = NULL,
              last_used_at = NULL, expires_at = NULL
              WHERE id = ? AND namespace = ? AND source = 'automatic'`,
          )
          .run(`deleted:${candidate.legacy_memory_id}`, now, candidate.legacy_memory_id, namespace);
        this.database.connection
          .prepare('DELETE FROM memories_fts WHERE id = ?')
          .run(candidate.legacy_memory_id);
      }
      this.database.connection
        .prepare('DELETE FROM memory_candidate_evidence WHERE candidate_id = ?')
        .run(id);
      this.database.connection.exec('COMMIT');
      return Number(result.changes) > 0;
    } catch (error) {
      this.database.connection.exec('ROLLBACK');
      throw error;
    }
  }

  public save(
    namespace: string,
    candidateValue: MemoryCandidate,
    source: 'manual' | 'automatic',
    sourceMessageId?: string,
  ): MemoryRecord | undefined {
    if (source === 'automatic') {
      return undefined;
    }
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
    const memory = this.get(namespace, id);
    if (!memory) {
      return false;
    }
    const relatedIds = this.database.connection
      .prepare(
        `SELECT id FROM memories
          WHERE namespace = ? AND normalized_key = ? AND status <> 'deleted'`,
      )
      .all(namespace, memory.normalizedKey) as unknown as { id: string }[];
    return (
      this.scrub(
        namespace,
        relatedIds.map((row) => row.id),
        [memory.normalizedKey],
      ) > 0
    );
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
    const candidateIds = this.database.connection
      .prepare(
        `SELECT id, normalized_key, content FROM memory_candidates
          WHERE namespace = ? AND content <> ''`,
      )
      .all(namespace)
      .filter((value) => {
        const candidate = value as { normalized_key: string; content: string };
        const searchable = normalizeMemoryKey(`${candidate.normalized_key} ${candidate.content}`);
        return (
          searchable.includes(normalized) ||
          normalized.includes(normalizeMemoryKey(candidate.content))
        );
      })
      .map((value) => (value as { id: string }).id);
    return this.scrub(
      namespace,
      matches.map((memory) => memory.id),
      [],
      candidateIds,
    );
  }

  public clear(namespace: string): number {
    const rows = this.database.connection
      .prepare(`SELECT id FROM memories WHERE namespace = ? AND status <> 'deleted'`)
      .all(namespace) as unknown as { id: string }[];
    return this.scrub(
      namespace,
      rows.map((row) => row.id),
      [],
      undefined,
      true,
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

  private findActiveByKey(namespace: string, normalizedKey: string): MemoryRow | undefined {
    return this.database.connection
      .prepare(
        `SELECT memories.*, messages.content AS source_excerpt
           FROM memories
           LEFT JOIN messages ON messages.id = memories.source_message_id
          WHERE memories.namespace = ? AND memories.normalized_key = ?
            AND memories.status = 'active'
          ORDER BY memories.updated_at DESC LIMIT 1`,
      )
      .get(namespace, normalizedKey) as unknown as MemoryRow | undefined;
  }

  private getCandidateRow(namespace: string, id: string): MemoryCandidateRow | undefined {
    return this.database.connection
      .prepare('SELECT * FROM memory_candidates WHERE id = ? AND namespace = ?')
      .get(id, namespace) as unknown as MemoryCandidateRow | undefined;
  }

  private getCandidate(namespace: string, id: string): MemoryCandidateRecord | undefined {
    const row = this.getCandidateRow(namespace, id);
    return row ? this.rowToCandidate(row) : undefined;
  }

  private rowToCandidate(row: MemoryCandidateRow): MemoryCandidateRecord {
    const evidenceRows = this.database.connection
      .prepare(
        `SELECT memory_candidate_evidence.source_message_id,
                memory_candidate_evidence.observed_at,
                messages.content AS source_excerpt
           FROM memory_candidate_evidence
           LEFT JOIN messages ON messages.id = memory_candidate_evidence.source_message_id
          WHERE memory_candidate_evidence.candidate_id = ?
          ORDER BY memory_candidate_evidence.observed_at DESC`,
      )
      .all(row.id) as unknown as MemoryEvidenceRow[];
    const evidence = evidenceRows.map(rowToEvidence);
    const evidenceDateCount = new Set(
      evidence.map((item) => Math.floor(item.observedAt / (24 * 60 * 60 * 1_000))),
    ).size;
    const conflictingMemory = row.conflicting_memory_id
      ? this.get(row.namespace, row.conflicting_memory_id)
      : undefined;
    return {
      id: row.id,
      namespace: row.namespace,
      type: row.type,
      normalizedKey: row.normalized_key,
      content: row.content,
      importance: row.importance,
      confidence: row.confidence,
      status: row.status,
      reviewReasons: parseReviewReasons(row.review_reasons_json),
      evidence,
      evidenceDateCount,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastSeenAt: row.last_seen_at,
      ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
      ...(row.decision_at ? { decisionAt: row.decision_at } : {}),
      ...(conflictingMemory ? { conflictingMemory } : {}),
    };
  }

  private latestEvidence(candidateId: string): MemoryEvidenceRow | undefined {
    return this.database.connection
      .prepare(
        `SELECT source_message_id, observed_at, NULL AS source_excerpt
           FROM memory_candidate_evidence
          WHERE candidate_id = ? ORDER BY observed_at DESC LIMIT 1`,
      )
      .get(candidateId) as unknown as MemoryEvidenceRow | undefined;
  }

  private insertEvidence(candidateId: string, evidence: MemoryEvidenceSource): void {
    this.database.connection
      .prepare(
        `INSERT OR IGNORE INTO memory_candidate_evidence (
          candidate_id, source_message_id, observed_at
        ) VALUES (?, ?, ?)`,
      )
      .run(candidateId, evidence.id, Math.trunc(evidence.createdAt));
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

  private scrub(
    namespace: string,
    ids: string[],
    candidateKeys: string[] = [],
    candidateIds?: string[],
    allCandidates = false,
  ): number {
    if (ids.length === 0 && candidateKeys.length === 0 && !candidateIds?.length && !allCandidates) {
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
      const selectedCandidateIds = allCandidates
        ? (
            this.database.connection
              .prepare(`SELECT id FROM memory_candidates WHERE namespace = ? AND content <> ''`)
              .all(namespace) as unknown as { id: string }[]
          ).map((row) => row.id)
        : [
            ...(candidateIds ?? []),
            ...candidateKeys.flatMap((key) =>
              (
                this.database.connection
                  .prepare(
                    `SELECT id FROM memory_candidates
                      WHERE namespace = ? AND normalized_key = ? AND content <> ''`,
                  )
                  .all(namespace, key) as unknown as { id: string }[]
              ).map((row) => row.id),
            ),
          ];
      for (const candidateId of new Set(selectedCandidateIds)) {
        const result = this.database.connection
          .prepare(
            `UPDATE memory_candidates SET
              normalized_key = ?, content = '', status = 'rejected',
              review_reasons_json = '[]', conflicting_memory_id = NULL,
              legacy_memory_id = NULL, updated_at = ?, decision_at = ?
              WHERE id = ? AND namespace = ? AND content <> ''`,
          )
          .run(`deleted:${candidateId}`, now, now, candidateId, namespace);
        changed += Number(result.changes);
        this.database.connection
          .prepare('DELETE FROM memory_candidate_evidence WHERE candidate_id = ?')
          .run(candidateId);
      }
      this.database.connection.exec('COMMIT');
      return changed;
    } catch (error) {
      this.database.connection.exec('ROLLBACK');
      throw error;
    }
  }
}
