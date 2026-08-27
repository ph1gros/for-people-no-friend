import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { adaptLegacyCharacterLore } from '../src/core/character/character-knowledge';
import { IRENA_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';
import { CharacterKnowledgeStore } from '../src/main/storage/character-knowledge-store';
import { DeskpetDatabase } from '../src/main/storage/deskpet-database';

describe('V1.2 character knowledge storage', () => {
  let directory: string | undefined;
  let database: DeskpetDatabase | undefined;

  afterEach(async () => {
    database?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    database = undefined;
    directory = undefined;
  });

  const createStore = async (): Promise<CharacterKnowledgeStore> => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-character-knowledge-'));
    database = new DeskpetDatabase(directory);
    return new CharacterKnowledgeStore(database);
  };

  it('persists sources, field paths and evidence basis in SQLite', async () => {
    const store = await createStore();
    const base = adaptLegacyCharacterLore(
      IRENA_CHARACTER_PROFILE.memoryNamespace,
      IRENA_CHARACTER_PROFILE.lore!,
    );
    store.replace(base);

    const restored = store.get('character-irena');
    expect(restored).toMatchObject({
      schemaVersion: 1,
      characterNamespace: 'character-irena',
      profileRevision: expect.stringMatching(/^lore-v1-[a-f\d]{16}$/),
      sourceWork: '魔女之旅',
    });
    expect(restored?.sources).toHaveLength(4);
    expect(restored?.records.find(({ kind }) => kind === 'identity')?.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldPath: 'lore.identity', basis: 'legacy-aggregate' }),
      ]),
    );
    expect(restored?.records.find(({ kind }) => kind === 'scenario')?.evidence[0]).toMatchObject({
      fieldPath: 'lore.roleplayExamples[0]',
      basis: 'synthesized',
    });
  });

  it('replaces one namespace atomically without touching another character', async () => {
    const store = await createStore();
    const m3 = adaptLegacyCharacterLore(
      IRENA_CHARACTER_PROFILE.memoryNamespace,
      IRENA_CHARACTER_PROFILE.lore!,
    );
    const other = {
      ...m3,
      characterNamespace: 'character-other',
      records: m3.records.map((record) => ({
        ...record,
        id: record.id.replace('character-irena', 'character-other'),
        characterNamespace: 'character-other',
      })),
    };
    store.replace(m3);
    store.replace(other);
    store.replace({ ...m3, sourceWork: '更新后的魔女之旅' });

    expect(store.get('character-irena')?.sourceWork).toBe('更新后的魔女之旅');
    expect(store.get('character-other')?.sourceWork).toBe('魔女之旅');
  });

  it('hard-deletes only the requested character namespace and its evidence', async () => {
    const store = await createStore();
    const base = adaptLegacyCharacterLore(
      IRENA_CHARACTER_PROFILE.memoryNamespace,
      IRENA_CHARACTER_PROFILE.lore!,
    );
    store.replace(base);
    expect(store.clear('character-irena')).toBe(base.records.length);
    expect(store.get('character-irena')).toBeUndefined();
    expect(
      database?.connection
        .prepare(
          `SELECT COUNT(*) AS count FROM character_knowledge_evidence
            WHERE character_namespace = ?`,
        )
        .get('character-irena'),
    ).toEqual({ count: 0 });
  });

  it('rejects dangling field evidence before starting a database transaction', async () => {
    const store = await createStore();
    const base = adaptLegacyCharacterLore(
      IRENA_CHARACTER_PROFILE.memoryNamespace,
      IRENA_CHARACTER_PROFILE.lore!,
    );
    const invalid = {
      ...base,
      records: base.records.map((record, index) =>
        index === 0
          ? {
              ...record,
              evidence: [
                {
                  sourceId: 'missing-source',
                  fieldPath: 'lore.identity',
                  basis: 'direct' as const,
                },
              ],
            }
          : record,
      ),
    };
    expect(() => store.replace(invalid)).toThrow('invalid references');
    expect(store.get('character-irena')).toBeUndefined();
  });

  it('soft-degrades corrupt persisted source data to no knowledge base', async () => {
    const store = await createStore();
    const base = adaptLegacyCharacterLore(
      IRENA_CHARACTER_PROFILE.memoryNamespace,
      IRENA_CHARACTER_PROFILE.lore!,
    );
    store.replace(base);
    database?.connection
      .prepare(
        `UPDATE character_knowledge_sources SET url = 'http://unsafe.example/'
          WHERE character_namespace = ?`,
      )
      .run('character-irena');
    expect(store.get('character-irena')).toBeUndefined();
  });

  it('soft-degrades a corrupt keyword index instead of returning partial records', async () => {
    const store = await createStore();
    const base = adaptLegacyCharacterLore(
      IRENA_CHARACTER_PROFILE.memoryNamespace,
      IRENA_CHARACTER_PROFILE.lore!,
    );
    store.replace(base);
    database?.connection
      .prepare(
        `UPDATE character_knowledge_records SET keywords_json = 'not-json'
          WHERE character_namespace = ? AND id = ?`,
      )
      .run('character-irena', base.records[0]?.id ?? '');
    expect(store.get('character-irena')).toBeUndefined();
  });

  it('upgrades an already-created V1.2 database with a safe empty revision', async () => {
    await createStore();
    const databasePath = database!.path;
    database?.close();
    database = undefined;
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      ALTER TABLE character_knowledge_namespaces DROP COLUMN profile_revision;
      PRAGMA user_version = 4;
    `);
    legacy.close();

    database = new DeskpetDatabase(directory!);

    expect(database.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: 5 });
    expect(
      database.connection
        .prepare(`SELECT name FROM pragma_table_info('character_knowledge_namespaces')`)
        .all(),
    ).toEqual(expect.arrayContaining([{ name: 'profile_revision' }]));
  });
});
