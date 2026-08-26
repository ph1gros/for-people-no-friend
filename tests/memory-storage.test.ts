import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { deriveMemoryKey } from '../src/core/memory/memory-policy';
import { DeskpetDatabase } from '../src/main/storage/deskpet-database';
import { MemoryStore } from '../src/main/storage/memory-store';

describe('M5 SQLite storage and memory lifecycle', () => {
  let directory: string | undefined;
  let database: DeskpetDatabase | undefined;

  afterEach(async () => {
    database?.close();
    database = undefined;
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it('migrates the validated M4 conversation file once', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-memory-migration-'));
    await writeFile(
      path.join(directory, 'conversation.v1.json'),
      JSON.stringify({
        version: 1,
        messages: [
          {
            id: 'legacy-user',
            role: 'user',
            content: '旧消息',
            createdAt: 1,
            status: 'complete',
          },
        ],
      }),
      'utf8',
    );
    database = new DeskpetDatabase(directory);
    expect(database.listMessages()).toEqual([
      expect.objectContaining({ id: 'legacy-user', content: '旧消息' }),
    ]);

    database.close();
    database = new DeskpetDatabase(directory);
    expect(database.listMessages()).toHaveLength(1);
  });

  it('migrates active automatic memories to candidates without changing manual memories', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-trusted-memory-migration-'));
    const legacy = new DatabaseSync(path.join(directory, 'deskpet.v1.sqlite'));
    legacy.exec(`
      CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
        content TEXT NOT NULL, provider_id TEXT, model_id TEXT, created_at INTEGER NOT NULL,
        status TEXT NOT NULL, emotion TEXT, action TEXT, input_tokens INTEGER, output_tokens INTEGER
      );
      CREATE TABLE session_summaries (
        conversation_id TEXT PRIMARY KEY, summary_json TEXT NOT NULL,
        covered_until_message_id TEXT, updated_at INTEGER NOT NULL
      );
      CREATE TABLE memories (
        id TEXT PRIMARY KEY, namespace TEXT NOT NULL, type TEXT NOT NULL,
        normalized_key TEXT NOT NULL, content TEXT NOT NULL, importance REAL NOT NULL,
        confidence REAL NOT NULL, source_message_id TEXT, source TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        last_confirmed_at INTEGER, last_used_at INTEGER, expires_at INTEGER, status TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE memories_fts USING fts5(
        id UNINDEXED, namespace UNINDEXED, normalized_key, content, tokenize = 'unicode61'
      );
      INSERT INTO messages (
        id, conversation_id, role, content, created_at, status
      ) VALUES ('source-auto', 'default', 'user', '我喜欢蓝色', 1234, 'complete');
      INSERT INTO memories VALUES (
        'manual-memory', 'default-character', 'fact', 'fact:cat', '用户的猫叫团子',
        0.9, 1, NULL, 'manual', 1000, 1000, 1000, NULL, NULL, 'active'
      );
      INSERT INTO memories VALUES (
        'automatic-memory', 'default-character', 'preference', 'preference:蓝色', '用户喜欢蓝色',
        0.8, 0.9, 'source-auto', 'automatic', 1200, 1200, 1200, NULL, NULL, 'active'
      );
      INSERT INTO memories_fts VALUES (
        'manual-memory', 'default-character', 'fact:cat', '用户的猫叫团子'
      );
      INSERT INTO memories_fts VALUES (
        'automatic-memory', 'default-character', 'preference:蓝色', '用户喜欢蓝色'
      );
      PRAGMA user_version = 1;
    `);
    legacy.close();

    database = new DeskpetDatabase(directory);
    const store = new MemoryStore(database);
    expect(database.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    expect(store.list('default-character')).toEqual([
      expect.objectContaining({ id: 'manual-memory', content: '用户的猫叫团子', source: 'manual' }),
    ]);
    expect(store.listCandidates('default-character')).toEqual([
      expect.objectContaining({
        content: '用户喜欢蓝色',
        status: 'pending',
        reviewReasons: ['legacy_automatic'],
        evidence: [
          expect.objectContaining({
            sourceMessageId: 'source-auto',
            observedAt: 1234,
            sourceExcerpt: '我喜欢蓝色',
          }),
        ],
      }),
    ]);
    expect(
      database.connection
        .prepare('SELECT status FROM memories WHERE id = ?')
        .get('automatic-memory'),
    ).toEqual({ status: 'superseded' });
    expect(database.connection.prepare('SELECT id FROM memories_fts ORDER BY id').all()).toEqual([
      { id: 'manual-memory' },
    ]);

    database.close();
    database = new DeskpetDatabase(directory);
    const reopenedStore = new MemoryStore(database);
    const migratedCandidate = reopenedStore.listCandidates('default-character');
    expect(migratedCandidate).toHaveLength(1);
    expect(reopenedStore.rejectCandidate('default-character', migratedCandidate[0]?.id ?? '')).toBe(
      true,
    );
    expect(
      database.connection
        .prepare('SELECT content, source_message_id, status FROM memories WHERE id = ?')
        .get('automatic-memory'),
    ).toEqual({ content: '', source_message_id: null, status: 'deleted' });
  });

  it('keeps manual memories authoritative and supersedes an old preference on manual update', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-memory-store-'));
    database = new DeskpetDatabase(directory);
    const store = new MemoryStore(database);
    const namespace = 'default-character';
    const oldContent = '我喜欢草莓蛋糕';
    const key = deriveMemoryKey(oldContent, 'preference');
    const original = store.save(
      namespace,
      {
        type: 'preference',
        normalizedKey: key,
        content: oldContent,
        importance: 0.9,
        confidence: 1,
      },
      'manual',
      'message-1',
    );
    expect(original).toBeDefined();

    expect(
      store.save(
        namespace,
        {
          type: 'preference',
          normalizedKey: key,
          content: '我现在不喜欢草莓蛋糕',
          importance: 0.8,
          confidence: 0.95,
        },
        'automatic',
        'message-2',
      ),
    ).toBeUndefined();
    expect(store.list(namespace)).toHaveLength(1);

    const replacement = store.save(
      namespace,
      {
        type: 'preference',
        normalizedKey: key,
        content: '我现在不喜欢草莓蛋糕',
        importance: 0.9,
        confidence: 1,
      },
      'manual',
      'message-3',
    );
    expect(replacement?.content).toContain('不喜欢');
    expect(store.list(namespace)).toEqual([
      expect.objectContaining({ content: '我现在不喜欢草莓蛋糕', status: 'active' }),
    ]);
    const superseded = database.connection
      .prepare(`SELECT status FROM memories WHERE id = ?`)
      .get(original?.id ?? '') as { status: string };
    expect(superseded.status).toBe('superseded');
  });

  it('retrieves related facts, expires old facts and scrubs deleted content', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-memory-retrieve-'));
    database = new DeskpetDatabase(directory);
    const store = new MemoryStore(database);
    const namespace = 'default-character';
    const cat = store.save(
      namespace,
      {
        type: 'fact',
        normalizedKey: 'cat-name',
        content: '用户的猫叫团子',
        importance: 0.8,
        confidence: 1,
      },
      'manual',
    );
    expect(store.retrieve(namespace, '我的猫叫什么？')).toEqual([
      expect.objectContaining({ id: cat?.id, content: '用户的猫叫团子' }),
    ]);
    expect(store.delete(namespace, cat?.id ?? '')).toBe(true);
    expect(store.list(namespace)).toEqual([]);
    expect(
      database.connection
        .prepare(
          `SELECT content, normalized_key, source_message_id, status FROM memories WHERE id = ?`,
        )
        .get(cat?.id ?? ''),
    ).toEqual({
      content: '',
      normalized_key: `deleted:${cat?.id}`,
      source_message_id: null,
      status: 'deleted',
    });

    const expiring = store.save(
      namespace,
      {
        type: 'plan',
        normalizedKey: 'temporary-plan',
        content: '用户计划今晚散步',
        importance: 0.6,
        confidence: 0.8,
        expiresAt: Date.now() + 60_000,
      },
      'manual',
    );
    database.connection
      .prepare('UPDATE memories SET expires_at = ? WHERE id = ?')
      .run(Date.now() - 1, expiring?.id ?? '');
    expect(store.list(namespace)).toEqual([]);
  });

  it('forgets matching active and superseded versions and clears every retained memory', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-memory-forget-'));
    database = new DeskpetDatabase(directory);
    const store = new MemoryStore(database);
    const namespace = 'default-character';
    const key = deriveMemoryKey('我喜欢咖啡', 'preference');
    store.save(
      namespace,
      {
        type: 'preference',
        normalizedKey: key,
        content: '我喜欢咖啡',
        importance: 0.8,
        confidence: 1,
      },
      'manual',
    );
    store.save(
      namespace,
      {
        type: 'preference',
        normalizedKey: key,
        content: '我现在不喜欢咖啡',
        importance: 0.8,
        confidence: 1,
      },
      'manual',
    );
    expect(store.forget(namespace, '咖啡')).toBe(2);
    expect(
      database.connection
        .prepare(`SELECT content, status FROM memories WHERE namespace = ? ORDER BY created_at`)
        .all(namespace),
    ).toEqual([
      { content: '', status: 'deleted' },
      { content: '', status: 'deleted' },
    ]);

    store.save(
      namespace,
      {
        type: 'fact',
        normalizedKey: 'pet',
        content: '用户养了一只猫',
        importance: 0.7,
        confidence: 1,
      },
      'manual',
    );
    expect(store.clear(namespace)).toBe(1);
    expect(
      database.connection
        .prepare(`SELECT COUNT(*) AS count FROM memories WHERE content <> ''`)
        .get(),
    ).toEqual({ count: 0 });
  });

  it('keeps automatic claims as evidenced candidates until the user confirms or rejects them', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-memory-candidates-'));
    database = new DeskpetDatabase(directory);
    const store = new MemoryStore(database);
    const namespace = 'default-character';
    const key = deriveMemoryKey('我喜欢草莓蛋糕', 'preference');
    const active = store.save(
      namespace,
      {
        type: 'preference',
        normalizedKey: key,
        content: '我喜欢草莓蛋糕',
        importance: 0.9,
        confidence: 1,
      },
      'manual',
    );
    database.appendMessage({
      id: 'source-1',
      role: 'user',
      content: '我现在不喜欢草莓蛋糕了',
      createdAt: 1,
      status: 'complete',
    });
    database.appendMessage({
      id: 'source-2',
      role: 'user',
      content: '还是不喜欢草莓蛋糕',
      createdAt: 86_400_001,
      status: 'complete',
    });
    const candidateValue = {
      type: 'preference' as const,
      normalizedKey: key,
      content: '我现在不喜欢草莓蛋糕',
      importance: 0.8,
      confidence: 0.9,
    };
    const candidate = store.saveAutomaticCandidate(namespace, candidateValue, {
      id: 'source-1',
      createdAt: 1,
    });
    store.saveAutomaticCandidate(namespace, candidateValue, {
      id: 'source-2',
      createdAt: 86_400_001,
    });

    expect(store.list(namespace)).toEqual([
      expect.objectContaining({ id: active?.id, content: '我喜欢草莓蛋糕' }),
    ]);
    expect(store.listCandidates(namespace)).toEqual([
      expect.objectContaining({
        id: candidate?.id,
        status: 'conflict',
        reviewReasons: expect.arrayContaining(['conflict', 'profile_claim']),
        evidenceDateCount: 2,
        evidence: [
          expect.objectContaining({
            sourceMessageId: 'source-2',
            sourceExcerpt: '还是不喜欢草莓蛋糕',
          }),
          expect.objectContaining({ sourceMessageId: 'source-1' }),
        ],
        conflictingMemory: expect.objectContaining({ id: active?.id }),
      }),
    ]);
    expect(store.retrieve(namespace, '草莓蛋糕')).toEqual([
      expect.objectContaining({ id: active?.id, content: '我喜欢草莓蛋糕' }),
    ]);
    expect(store.confirmCandidate('other-character', candidate?.id ?? '')).toBeUndefined();
    expect(store.confirmCandidate(namespace, candidate?.id ?? '')).toEqual(
      expect.objectContaining({ content: '我现在不喜欢草莓蛋糕', source: 'automatic' }),
    );
    expect(store.listCandidates(namespace)).toEqual([]);
    expect(
      database.connection.prepare('SELECT status FROM memories WHERE id = ?').get(active?.id ?? ''),
    ).toEqual({ status: 'superseded' });

    const uncertain = store.saveAutomaticCandidate(
      namespace,
      {
        type: 'plan',
        normalizedKey: 'plan:trip',
        content: '用户下周可能去旅行',
        importance: 0.7,
        confidence: 0.8,
      },
      { id: 'source-2', createdAt: 86_400_001 },
    );
    expect(uncertain?.reviewReasons).toContain('time_uncertain');
    expect(store.rejectCandidate(namespace, uncertain?.id ?? '')).toBe(true);
    expect(store.listCandidates(namespace)).toEqual([]);
    expect(
      database.connection
        .prepare('SELECT content FROM memory_candidates WHERE id = ?')
        .get(uncertain?.id ?? ''),
    ).toEqual({ content: '' });
    expect(
      store.saveAutomaticCandidate(
        namespace,
        {
          type: 'plan',
          normalizedKey: 'plan:trip',
          content: '用户下周可能去旅行',
          importance: 0.7,
          confidence: 0.8,
        },
        { id: 'source-3', createdAt: 172_800_001 },
      ),
    ).toBeUndefined();
  });

  it('edits candidate expiry and can keep both sides of an explicit conflict', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-memory-candidate-edit-'));
    database = new DeskpetDatabase(directory);
    const store = new MemoryStore(database);
    const namespace = 'default-character';
    const expiresAt = Date.now() + 86_400_000;
    const plan = store.saveAutomaticCandidate(
      namespace,
      {
        type: 'plan',
        normalizedKey: 'weekend-walk',
        content: '用户计划周末散步',
        importance: 0.6,
        confidence: 0.8,
      },
      { id: 'plan-source', createdAt: 1 },
    );
    expect(
      store.updateCandidate(namespace, plan?.id ?? '', {
        type: 'plan',
        normalizedKey: 'ignored-by-editor',
        content: '用户计划周末散步',
        importance: 0.75,
        confidence: 0.9,
        expiresAt,
      }),
    ).toEqual(expect.objectContaining({ expiresAt, importance: 0.75, confidence: 0.9 }));
    const confirmedPlan = store.confirmCandidate(namespace, plan?.id ?? '');
    expect(confirmedPlan).toEqual(
      expect.objectContaining({ content: '用户计划周末散步', expiresAt }),
    );
    const planWithoutExpiry = store.update(namespace, confirmedPlan?.id ?? '', {
      type: 'plan',
      normalizedKey: 'weekend-walk',
      content: '用户计划周末散步',
      importance: 0.75,
      confidence: 0.9,
    });
    expect(planWithoutExpiry?.expiresAt).toBeUndefined();

    const oldPreference = store.save(
      namespace,
      {
        type: 'preference',
        normalizedKey: deriveMemoryKey('我喜欢咖啡', 'preference'),
        content: '我喜欢咖啡',
        importance: 0.9,
        confidence: 1,
      },
      'manual',
    );
    const newPreference = store.saveAutomaticCandidate(
      namespace,
      {
        type: 'preference',
        normalizedKey: deriveMemoryKey('我不喜欢咖啡', 'preference'),
        content: '我不喜欢咖啡',
        importance: 0.8,
        confidence: 0.9,
      },
      { id: 'preference-source', createdAt: 2 },
    );
    expect(newPreference?.status).toBe('conflict');
    expect(store.confirmCandidate(namespace, newPreference?.id ?? '', 'keep-both')).toBeDefined();
    expect(store.list(namespace)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: oldPreference?.id, content: '我喜欢咖啡' }),
        expect.objectContaining({ content: '我不喜欢咖啡' }),
      ]),
    );
  });

  it('merges same-key candidates and moves their evidence without crossing namespaces', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-memory-candidate-merge-'));
    database = new DeskpetDatabase(directory);
    const store = new MemoryStore(database);
    const namespace = 'default-character';
    const first = store.saveAutomaticCandidate(
      namespace,
      {
        type: 'fact',
        normalizedKey: 'pet-name',
        content: '用户的猫叫团子',
        importance: 0.7,
        confidence: 0.8,
      },
      { id: 'merge-source-1', createdAt: 1 },
    );
    const second = store.saveAutomaticCandidate(
      namespace,
      {
        type: 'fact',
        normalizedKey: 'pet-name',
        content: '用户称自己的猫为团子',
        importance: 0.85,
        confidence: 0.95,
      },
      { id: 'merge-source-2', createdAt: 86_400_001 },
    );

    expect(
      store.mergeCandidates('other-character', first?.id ?? '', second?.id ?? ''),
    ).toBeUndefined();
    expect(store.mergeCandidates(namespace, first?.id ?? '', second?.id ?? '')).toEqual(
      expect.objectContaining({
        id: first?.id,
        content: '用户的猫叫团子',
        importance: 0.85,
        confidence: 0.95,
        evidenceDateCount: 2,
        evidence: expect.arrayContaining([
          expect.objectContaining({ sourceMessageId: 'merge-source-1' }),
          expect.objectContaining({ sourceMessageId: 'merge-source-2' }),
        ]),
      }),
    );
    expect(store.listCandidates(namespace)).toHaveLength(1);
    expect(
      database.connection
        .prepare('SELECT content, status FROM memory_candidates WHERE id = ?')
        .get(second?.id ?? ''),
    ).toEqual({ content: '', status: 'rejected' });
  });

  it('scrubs candidate content and evidence when all memories are cleared', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-memory-candidate-clear-'));
    database = new DeskpetDatabase(directory);
    const store = new MemoryStore(database);
    const candidate = store.saveAutomaticCandidate(
      'default-character',
      {
        type: 'fact',
        normalizedKey: 'pet-name',
        content: '用户的猫叫团子',
        importance: 0.8,
        confidence: 0.9,
      },
      { id: 'source-message', createdAt: 1 },
    );
    expect(candidate).toBeDefined();
    expect(store.clear('default-character')).toBe(1);
    expect(
      database.connection
        .prepare('SELECT content, normalized_key FROM memory_candidates WHERE id = ?')
        .get(candidate?.id ?? ''),
    ).toEqual({ content: '', normalized_key: `deleted:${candidate?.id}` });
    expect(
      database.connection
        .prepare('SELECT COUNT(*) AS count FROM memory_candidate_evidence WHERE candidate_id = ?')
        .get(candidate?.id ?? ''),
    ).toEqual({ count: 0 });
  });

  it('creates a consistent SQLite backup', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-memory-backup-'));
    database = new DeskpetDatabase(directory);
    database.appendMessage({
      id: 'message',
      role: 'user',
      content: '需要备份',
      createdAt: 1,
      status: 'complete',
    });
    const backupPath = path.join(directory, 'backup.sqlite');
    await database.backup(backupPath);
    const bytes = await readFile(backupPath);
    expect(bytes.length).toBeGreaterThan(0);
    const backupDatabase = new DeskpetDatabase(directory, 'backup.sqlite');
    expect(backupDatabase.listMessages()).toEqual([
      expect.objectContaining({ id: 'message', content: '需要备份' }),
    ]);
    backupDatabase.close();
  });
});
