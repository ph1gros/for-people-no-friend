import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
      'automatic',
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
