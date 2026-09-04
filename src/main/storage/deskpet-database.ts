import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as nodeSqlite from 'node:sqlite';

import type { SessionSummary } from '../../core/memory/contracts';
import type { ConversationMessage } from '../../shared/conversation-ipc';

const DEFAULT_CONVERSATION_ID = 'default-character';
const DATABASE_FILE_NAME = 'deskpet.v1.sqlite';
const LEGACY_CONVERSATION_FILE = 'conversation.v1.json';
const MAX_STORED_MESSAGES = 2_000;
const MESSAGE_PRUNE_BATCH_SIZE = 100;

export const isSqliteBackupSupported = (
  sqlite: { backup?: unknown } = nodeSqlite,
): sqlite is { backup: typeof nodeSqlite.backup } => typeof sqlite.backup === 'function';

interface MessageRow {
  id: string;
  role: string;
  content: string;
  provider_id: string | null;
  model_id: string | null;
  created_at: number;
  status: string;
  emotion: string | null;
  action: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

const isLegacyMessage = (value: unknown): value is ConversationMessage =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  typeof value.id === 'string' &&
  'role' in value &&
  (value.role === 'user' || value.role === 'assistant') &&
  'content' in value &&
  typeof value.content === 'string' &&
  'createdAt' in value &&
  typeof value.createdAt === 'number' &&
  'status' in value &&
  (value.status === 'complete' || value.status === 'cancelled');

const rowToMessage = (row: MessageRow): ConversationMessage => ({
  id: row.id,
  role: row.role as ConversationMessage['role'],
  content: row.content,
  createdAt: row.created_at,
  status: row.status as ConversationMessage['status'],
  ...(row.emotion ? { emotion: row.emotion as NonNullable<ConversationMessage['emotion']> } : {}),
  ...(row.action ? { action: row.action } : {}),
  ...(row.provider_id ? { providerId: row.provider_id } : {}),
  ...(row.model_id ? { modelId: row.model_id } : {}),
  ...(row.input_tokens !== null ? { inputTokens: row.input_tokens } : {}),
  ...(row.output_tokens !== null ? { outputTokens: row.output_tokens } : {}),
});

export class DeskpetDatabase {
  public readonly path: string;
  public readonly connection: nodeSqlite.DatabaseSync;
  private closed = false;

  public constructor(userDataPath: string, fileName = DATABASE_FILE_NAME) {
    mkdirSync(userDataPath, { recursive: true });
    this.path = path.join(userDataPath, fileName);
    this.connection = new nodeSqlite.DatabaseSync(this.path);
    this.connection.exec(
      'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;',
    );
    this.migrate();
    this.importLegacyConversation(userDataPath);
  }

  public listMessages(limit = 100, namespace = DEFAULT_CONVERSATION_ID): ConversationMessage[] {
    const boundedLimit = Math.max(0, Math.min(limit, MAX_STORED_MESSAGES));
    const rows = this.connection
      .prepare(
        `SELECT id, role, content, provider_id, model_id, created_at, status, emotion,
                action, input_tokens, output_tokens
           FROM messages
          WHERE conversation_id = ?
          ORDER BY created_at DESC, rowid DESC
          LIMIT ?`,
      )
      .all(namespace, boundedLimit) as unknown as MessageRow[];
    return rows.reverse().map(rowToMessage);
  }

  public appendMessage(message: ConversationMessage, namespace = DEFAULT_CONVERSATION_ID): void {
    this.connection
      .prepare(
        `INSERT INTO messages (
          id, conversation_id, role, content, provider_id, model_id, created_at,
          status, emotion, action, input_tokens, output_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        namespace,
        message.role,
        message.content,
        message.providerId ?? null,
        message.modelId ?? null,
        message.createdAt,
        message.status,
        message.emotion ?? null,
        message.action ?? null,
        message.inputTokens ?? null,
        message.outputTokens ?? null,
      );
    const storedCount = (
      this.connection
        .prepare('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?')
        .get(namespace) as { count: number }
    ).count;
    if (storedCount > MAX_STORED_MESSAGES + MESSAGE_PRUNE_BATCH_SIZE) {
      this.connection
        .prepare(
          `DELETE FROM messages
          WHERE conversation_id = ?
            AND rowid NOT IN (
              SELECT rowid FROM messages
               WHERE conversation_id = ?
               ORDER BY created_at DESC, rowid DESC
               LIMIT ?
            )`,
        )
        .run(namespace, namespace, MAX_STORED_MESSAGES);
    }
  }

  public clearMessages(namespace = DEFAULT_CONVERSATION_ID): void {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      this.connection.prepare('DELETE FROM messages WHERE conversation_id = ?').run(namespace);
      this.connection
        .prepare('DELETE FROM session_summaries WHERE conversation_id = ?')
        .run(namespace);
      this.connection.exec('COMMIT');
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  public getSummary(namespace = DEFAULT_CONVERSATION_ID): SessionSummary | undefined {
    const row = this.connection
      .prepare(
        `SELECT conversation_id, summary_json, covered_until_message_id, updated_at
           FROM session_summaries WHERE conversation_id = ?`,
      )
      .get(namespace) as
      | {
          conversation_id: string;
          summary_json: string;
          covered_until_message_id: string | null;
          updated_at: number;
        }
      | undefined;
    if (!row) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(row.summary_json) as unknown;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('summary' in parsed) ||
        typeof parsed.summary !== 'string'
      ) {
        return undefined;
      }
      return {
        conversationId: row.conversation_id,
        summary: parsed.summary,
        ...(row.covered_until_message_id
          ? { coveredUntilMessageId: row.covered_until_message_id }
          : {}),
        updatedAt: row.updated_at,
      };
    } catch {
      return undefined;
    }
  }

  public setSummary(
    summary: string,
    coveredUntilMessageId?: string,
    namespace = DEFAULT_CONVERSATION_ID,
  ): void {
    this.connection
      .prepare(
        `INSERT INTO session_summaries (
          conversation_id, summary_json, covered_until_message_id, updated_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(conversation_id) DO UPDATE SET
          summary_json = excluded.summary_json,
          covered_until_message_id = excluded.covered_until_message_id,
          updated_at = excluded.updated_at`,
      )
      .run(namespace, JSON.stringify({ summary }), coveredUntilMessageId ?? null, Date.now());
  }

  public getMetadata(key: string): string | undefined {
    const row = this.connection.prepare('SELECT value FROM app_metadata WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value;
  }

  public setMetadata(key: string, value: string): void {
    this.connection
      .prepare(
        'INSERT INTO app_metadata (key, value) VALUES (?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  public backup(destination: string): Promise<number> {
    if (!isSqliteBackupSupported()) {
      return Promise.reject(new Error('当前 Electron 运行环境不支持 SQLite 数据库备份。'));
    }
    return nodeSqlite.backup(this.connection, destination);
  }
  public close(): void {
    if (!this.closed) {
      this.connection.close();
      this.closed = true;
    }
  }

  private migrate(): void {
    let version = Number(
      (this.connection.prepare('PRAGMA user_version').get() as { user_version: number })
        .user_version,
    );
    if (version > 6) {
      throw new Error(`The deskpet database schema version ${version} is not supported.`);
    }
    if (version === 0) {
      this.connection.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        provider_id TEXT,
        model_id TEXT,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('complete', 'cancelled')),
        emotion TEXT,
        action TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER
      );
      CREATE INDEX messages_conversation_created
        ON messages(conversation_id, created_at);
      CREATE TABLE session_summaries (
        conversation_id TEXT PRIMARY KEY,
        summary_json TEXT NOT NULL,
        covered_until_message_id TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('preference', 'person', 'event', 'plan', 'fact')),
        normalized_key TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL NOT NULL CHECK (importance >= 0 AND importance <= 1),
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        source_message_id TEXT,
        source TEXT NOT NULL CHECK (source IN ('manual', 'automatic')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_confirmed_at INTEGER,
        last_used_at INTEGER,
        expires_at INTEGER,
        status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'deleted'))
      );
      CREATE INDEX memories_namespace_status
        ON memories(namespace, status, updated_at DESC);
      CREATE INDEX memories_namespace_key
        ON memories(namespace, normalized_key, status);
      CREATE VIRTUAL TABLE memories_fts USING fts5(
        id UNINDEXED,
        namespace UNINDEXED,
        normalized_key,
        content,
        tokenize = 'unicode61'
      );
      PRAGMA user_version = 1;
      COMMIT;
    `);
      version = 1;
    }
    if (version === 1) {
      this.migrateTrustedMemoryCandidates();
      version = 2;
    }
    if (version === 2) {
      this.migrateCharacterConversationNamespaces();
      version = 3;
    }
    if (version === 3) {
      this.migrateCharacterKnowledge();
      version = 4;
    }
    if (version === 4) {
      this.migrateCharacterKnowledgeProfileRevision();
      version = 5;
    }
    if (version === 5) {
      this.migrateMemoryCandidateSource();
    }
  }

  private migrateTrustedMemoryCandidates(): void {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      this.connection.exec(`
        CREATE TABLE memory_candidates (
          id TEXT PRIMARY KEY,
          namespace TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('preference', 'person', 'event', 'plan', 'fact')),
          normalized_key TEXT NOT NULL,
          content TEXT NOT NULL,
          importance REAL NOT NULL CHECK (importance >= 0 AND importance <= 1),
          confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
          status TEXT NOT NULL CHECK (status IN ('pending', 'conflict', 'rejected', 'confirmed')),
          review_reasons_json TEXT NOT NULL,
          conflicting_memory_id TEXT,
          legacy_memory_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          expires_at INTEGER,
          decision_at INTEGER,
          FOREIGN KEY(conflicting_memory_id) REFERENCES memories(id) ON DELETE SET NULL,
          FOREIGN KEY(legacy_memory_id) REFERENCES memories(id) ON DELETE SET NULL
        );
        CREATE INDEX memory_candidates_namespace_status
          ON memory_candidates(namespace, status, updated_at DESC);
        CREATE INDEX memory_candidates_namespace_key
          ON memory_candidates(namespace, normalized_key, status);
        CREATE TABLE memory_candidate_evidence (
          candidate_id TEXT NOT NULL,
          source_message_id TEXT NOT NULL,
          observed_at INTEGER NOT NULL,
          PRIMARY KEY(candidate_id, source_message_id),
          FOREIGN KEY(candidate_id) REFERENCES memory_candidates(id) ON DELETE CASCADE
        );
        CREATE INDEX memory_candidate_evidence_candidate
          ON memory_candidate_evidence(candidate_id, observed_at DESC);
      `);
      const legacyAutomatic = this.connection
        .prepare(
          `SELECT memories.*, messages.created_at AS source_created_at
             FROM memories
             LEFT JOIN messages ON messages.id = memories.source_message_id
            WHERE memories.source = 'automatic' AND memories.status = 'active'`,
        )
        .all() as unknown as Array<{
        id: string;
        namespace: string;
        type: string;
        normalized_key: string;
        content: string;
        importance: number;
        confidence: number;
        source_message_id: string | null;
        source_created_at: number | null;
        created_at: number;
        updated_at: number;
        expires_at: number | null;
      }>;
      const insertCandidate = this.connection.prepare(
        `INSERT INTO memory_candidates (
          id, namespace, type, normalized_key, content, importance, confidence,
          status, review_reasons_json, conflicting_memory_id, legacy_memory_id,
          created_at, updated_at, last_seen_at, expires_at, decision_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?, ?, ?, ?, ?, NULL)`,
      );
      const insertEvidence = this.connection.prepare(
        `INSERT INTO memory_candidate_evidence (candidate_id, source_message_id, observed_at)
         VALUES (?, ?, ?)`,
      );
      const now = Date.now();
      for (const memory of legacyAutomatic) {
        const candidateId = randomUUID();
        insertCandidate.run(
          candidateId,
          memory.namespace,
          memory.type,
          memory.normalized_key,
          memory.content,
          memory.importance,
          memory.confidence,
          JSON.stringify(['legacy_automatic']),
          memory.id,
          memory.created_at,
          now,
          memory.updated_at,
          memory.expires_at,
        );
        if (memory.source_message_id) {
          insertEvidence.run(
            candidateId,
            memory.source_message_id,
            memory.source_created_at ?? memory.created_at,
          );
        }
        this.connection
          .prepare(`UPDATE memories SET status = 'superseded', updated_at = ? WHERE id = ?`)
          .run(now, memory.id);
        this.connection.prepare('DELETE FROM memories_fts WHERE id = ?').run(memory.id);
      }
      this.connection.exec('PRAGMA user_version = 2; COMMIT');
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  private migrateCharacterConversationNamespaces(): void {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      this.connection
        .prepare('UPDATE messages SET conversation_id = ? WHERE conversation_id = ?')
        .run(DEFAULT_CONVERSATION_ID, 'default');
      this.connection
        .prepare('UPDATE session_summaries SET conversation_id = ? WHERE conversation_id = ?')
        .run(DEFAULT_CONVERSATION_ID, 'default');
      this.connection
        .prepare(
          `INSERT OR IGNORE INTO app_metadata (key, value)
           SELECT ?, value FROM app_metadata WHERE key = ?`,
        )
        .run(
          'automatic_memory_covered_until_message_id:default-character',
          'automatic_memory_covered_until_message_id',
        );
      this.connection.exec('PRAGMA user_version = 3; COMMIT');
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  private migrateCharacterKnowledge(): void {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      this.connection.exec(`
        CREATE TABLE character_knowledge_namespaces (
          character_namespace TEXT PRIMARY KEY,
          schema_version INTEGER NOT NULL CHECK (schema_version = 1),
          source_work TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE character_knowledge_sources (
          character_namespace TEXT NOT NULL,
          id TEXT NOT NULL,
          title TEXT NOT NULL,
          url TEXT NOT NULL,
          site_name TEXT NOT NULL,
          retrieved_at INTEGER NOT NULL,
          PRIMARY KEY(character_namespace, id),
          FOREIGN KEY(character_namespace)
            REFERENCES character_knowledge_namespaces(character_namespace) ON DELETE CASCADE
        );
        CREATE TABLE character_knowledge_records (
          character_namespace TEXT NOT NULL,
          id TEXT NOT NULL,
          schema_version INTEGER NOT NULL CHECK (schema_version = 1),
          kind TEXT NOT NULL CHECK (
            kind IN ('identity', 'trait', 'event', 'relationship', 'scenario',
                     'speech-rule', 'example-line')
          ),
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          keywords_json TEXT NOT NULL,
          importance REAL NOT NULL CHECK (importance >= 0 AND importance <= 1),
          PRIMARY KEY(character_namespace, id),
          FOREIGN KEY(character_namespace)
            REFERENCES character_knowledge_namespaces(character_namespace) ON DELETE CASCADE
        );
        CREATE INDEX character_knowledge_records_namespace_kind
          ON character_knowledge_records(character_namespace, kind, importance DESC);
        CREATE TABLE character_knowledge_evidence (
          character_namespace TEXT NOT NULL,
          record_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          field_path TEXT NOT NULL,
          basis TEXT NOT NULL CHECK (basis IN ('direct', 'synthesized', 'legacy-aggregate')),
          PRIMARY KEY(character_namespace, record_id, source_id, field_path),
          FOREIGN KEY(character_namespace, record_id)
            REFERENCES character_knowledge_records(character_namespace, id) ON DELETE CASCADE,
          FOREIGN KEY(character_namespace, source_id)
            REFERENCES character_knowledge_sources(character_namespace, id) ON DELETE CASCADE
        );
        CREATE INDEX character_knowledge_evidence_source
          ON character_knowledge_evidence(character_namespace, source_id);
        PRAGMA user_version = 4;
        COMMIT;
      `);
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  private migrateCharacterKnowledgeProfileRevision(): void {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      this.connection.exec(`
        ALTER TABLE character_knowledge_namespaces
          ADD COLUMN profile_revision TEXT NOT NULL DEFAULT '';
        PRAGMA user_version = 5;
        COMMIT;
      `);
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  private migrateMemoryCandidateSource(): void {
    const hasSourceColumn = (
      this.connection
        .prepare(`SELECT name FROM pragma_table_info('memory_candidates')`)
        .all() as unknown as Array<{ name: string }>
    ).some((column) => column.name === 'source');
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      if (!hasSourceColumn) {
        this.connection.exec(`
          ALTER TABLE memory_candidates
            ADD COLUMN source TEXT NOT NULL DEFAULT 'automatic'
            CHECK (source IN ('manual', 'automatic'));
        `);
      }
      this.connection.exec('PRAGMA user_version = 6; COMMIT');
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  private importLegacyConversation(userDataPath: string): void {
    const marker = this.connection
      .prepare('SELECT value FROM app_metadata WHERE key = ?')
      .get('legacy_conversation_v1_imported');
    if (marker) {
      return;
    }
    const legacyPath = path.join(userDataPath, LEGACY_CONVERSATION_FILE);
    let messages: ConversationMessage[] = [];
    if (existsSync(legacyPath)) {
      try {
        const parsed = JSON.parse(readFileSync(legacyPath, 'utf8')) as unknown;
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          'version' in parsed &&
          parsed.version === 1 &&
          'messages' in parsed &&
          Array.isArray(parsed.messages) &&
          parsed.messages.length <= MAX_STORED_MESSAGES &&
          parsed.messages.every(isLegacyMessage)
        ) {
          messages = parsed.messages;
        }
      } catch {
        messages = [];
      }
    }
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      if (
        messages.length > 0 &&
        (
          this.connection.prepare('SELECT COUNT(*) AS count FROM messages').get() as {
            count: number;
          }
        ).count === 0
      ) {
        for (const message of messages) {
          this.appendMessage(message);
        }
      }
      this.connection
        .prepare('INSERT INTO app_metadata (key, value) VALUES (?, ?)')
        .run('legacy_conversation_v1_imported', String(Date.now()));
      this.connection.exec('COMMIT');
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }
}
