import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

import type { SessionSummary } from '../../core/memory/contracts';
import type { ConversationMessage } from '../../shared/conversation-ipc';

const DEFAULT_CONVERSATION_ID = 'default';
const DATABASE_FILE_NAME = 'deskpet.v1.sqlite';
const LEGACY_CONVERSATION_FILE = 'conversation.v1.json';
const MAX_STORED_MESSAGES = 2_000;

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
  public readonly connection: DatabaseSync;
  private closed = false;

  public constructor(userDataPath: string, fileName = DATABASE_FILE_NAME) {
    mkdirSync(userDataPath, { recursive: true });
    this.path = path.join(userDataPath, fileName);
    this.connection = new DatabaseSync(this.path);
    this.connection.exec(
      'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;',
    );
    this.migrate();
    this.importLegacyConversation(userDataPath);
  }

  public listMessages(limit = 100): ConversationMessage[] {
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
      .all(DEFAULT_CONVERSATION_ID, boundedLimit) as unknown as MessageRow[];
    return rows.reverse().map(rowToMessage);
  }

  public appendMessage(message: ConversationMessage): void {
    this.connection
      .prepare(
        `INSERT INTO messages (
          id, conversation_id, role, content, provider_id, model_id, created_at,
          status, emotion, action, input_tokens, output_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        DEFAULT_CONVERSATION_ID,
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
      .run(DEFAULT_CONVERSATION_ID, DEFAULT_CONVERSATION_ID, MAX_STORED_MESSAGES);
  }

  public clearMessages(): void {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      this.connection
        .prepare('DELETE FROM messages WHERE conversation_id = ?')
        .run(DEFAULT_CONVERSATION_ID);
      this.connection
        .prepare('DELETE FROM session_summaries WHERE conversation_id = ?')
        .run(DEFAULT_CONVERSATION_ID);
      this.connection.exec('COMMIT');
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  public getSummary(): SessionSummary | undefined {
    const row = this.connection
      .prepare(
        `SELECT conversation_id, summary_json, covered_until_message_id, updated_at
           FROM session_summaries WHERE conversation_id = ?`,
      )
      .get(DEFAULT_CONVERSATION_ID) as
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

  public setSummary(summary: string, coveredUntilMessageId?: string): void {
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
      .run(
        DEFAULT_CONVERSATION_ID,
        JSON.stringify({ summary }),
        coveredUntilMessageId ?? null,
        Date.now(),
      );
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
    return backup(this.connection, destination);
  }
  public close(): void {
    if (!this.closed) {
      this.connection.close();
      this.closed = true;
    }
  }

  private migrate(): void {
    const version = Number(
      (this.connection.prepare('PRAGMA user_version').get() as { user_version: number })
        .user_version,
    );
    if (version > 1) {
      throw new Error(`The memory database schema version ${version} is not supported.`);
    }
    if (version === 1) {
      return;
    }
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
