import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { adaptLegacyCharacterLore } from '../src/core/character/character-knowledge';
import { KALTSIT_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';
import { CharacterKnowledgeStore } from '../src/main/storage/character-knowledge-store';
import { ConversationStore } from '../src/main/storage/conversation-store';
import { DeskpetDatabase } from '../src/main/storage/deskpet-database';

describe('V1.2 resilience and local data consistency', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('keeps a bounded long-running history isolated and readable after reopening', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-v12-soak-'));
    let database = new DeskpetDatabase(directory);
    let history = new ConversationStore(database);
    for (let index = 0; index < 2_050; index += 1) {
      await history.append(
        {
          id: `kaltsit-${index}`,
          role: index % 2 === 0 ? 'user' : 'assistant',
          content: `message-${index}`,
          createdAt: index + 1,
          status: 'complete',
        },
        'character-kaltsit',
      );
    }
    await history.append(
      {
        id: 'other-private',
        role: 'user',
        content: 'another namespace',
        createdAt: 1,
        status: 'complete',
      },
      'character-other',
    );
    expect(await history.list(5_000, 'character-kaltsit')).toHaveLength(2_000);
    expect((await history.list(5_000, 'character-kaltsit'))[0]?.id).toBe('kaltsit-50');
    expect(await history.list(100, 'character-other')).toEqual([
      expect.objectContaining({ id: 'other-private' }),
    ]);
    expect(
      database.connection.prepare('PRAGMA integrity_check').get() as { integrity_check: string },
    ).toEqual({ integrity_check: 'ok' });
    database.close();

    database = new DeskpetDatabase(directory);
    history = new ConversationStore(database);
    expect(await history.list(5_000, 'character-kaltsit')).toHaveLength(2_000);
    expect(await history.list(100, 'character-other')).toHaveLength(1);
    database.close();
  });

  it('batches message pruning and waits briefly for transient SQLite locks', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-v12-pruning-'));
    const database = new DeskpetDatabase(directory);
    for (let index = 0; index < 2_050; index += 1) {
      database.appendMessage(
        {
          id: `message-${index}`,
          role: 'user',
          content: `content-${index}`,
          createdAt: index,
          status: 'complete',
        },
        'character-batched',
      );
    }
    expect(
      database.connection
        .prepare('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?')
        .get('character-batched'),
    ).toEqual({ count: 2_050 });

    for (let index = 2_050; index < 2_101; index += 1) {
      database.appendMessage(
        {
          id: `message-${index}`,
          role: 'user',
          content: `content-${index}`,
          createdAt: index,
          status: 'complete',
        },
        'character-batched',
      );
    }
    expect(
      database.connection
        .prepare('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?')
        .get('character-batched'),
    ).toEqual({ count: 2_000 });
    expect(database.connection.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5_000 });
    database.close();
  });

  it('rolls back a failed character knowledge replacement without losing the old revision', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-v12-rollback-'));
    const database = new DeskpetDatabase(directory);
    const store = new CharacterKnowledgeStore(database);
    const original = adaptLegacyCharacterLore(
      KALTSIT_CHARACTER_PROFILE.memoryNamespace,
      KALTSIT_CHARACTER_PROFILE.lore!,
    );
    store.replace(original);
    database.connection.exec(`
      CREATE TRIGGER reject_fake_character_record
      BEFORE INSERT ON character_knowledge_records
      WHEN NEW.title = '触发事务回滚'
      BEGIN
        SELECT RAISE(ABORT, 'fake write failure');
      END;
    `);
    const replacement = {
      ...original,
      records: original.records.map((record, index) =>
        index === 0 ? { ...record, title: '触发事务回滚' } : record,
      ),
    };
    expect(() => store.replace(replacement)).toThrow('fake write failure');
    const restored = store.get(original.characterNamespace);
    expect(restored).toMatchObject({
      characterNamespace: original.characterNamespace,
      profileRevision: original.profileRevision,
      sourceWork: original.sourceWork,
    });
    expect(restored?.records.map(({ id }) => id).sort()).toEqual(
      original.records.map(({ id }) => id).sort(),
    );
    expect(restored?.sources.map(({ id }) => id).sort()).toEqual(
      original.sources.map(({ id }) => id).sort(),
    );
    expect(
      database.connection.prepare('PRAGMA integrity_check').get() as { integrity_check: string },
    ).toEqual({ integrity_check: 'ok' });
    database.close();
  });

  it('degrades a damaged optional character index to unavailable without touching chat data', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-v12-damaged-index-'));
    const database = new DeskpetDatabase(directory);
    const history = new ConversationStore(database);
    const store = new CharacterKnowledgeStore(database);
    const knowledge = adaptLegacyCharacterLore(
      KALTSIT_CHARACTER_PROFILE.memoryNamespace,
      KALTSIT_CHARACTER_PROFILE.lore!,
    );
    store.replace(knowledge);
    await history.append(
      { id: 'safe-message', role: 'user', content: '仍应保留', createdAt: 1, status: 'complete' },
      knowledge.characterNamespace,
    );
    database.connection
      .prepare(
        `UPDATE character_knowledge_records SET keywords_json = ?
          WHERE character_namespace = ? AND id = ?`,
      )
      .run('{broken', knowledge.characterNamespace, knowledge.records[0]!.id);
    expect(store.get(knowledge.characterNamespace)).toBeUndefined();
    expect(await history.list(10, knowledge.characterNamespace)).toEqual([
      expect.objectContaining({ id: 'safe-message', content: '仍应保留' }),
    ]);
    database.close();
  });
});
