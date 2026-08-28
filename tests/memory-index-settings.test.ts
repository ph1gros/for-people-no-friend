import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MemoryIndexConfigStore } from '../src/main/storage/memory-index-config-store';
import { parseSetMemorySettingsInput } from '../src/shared/memory-ipc';

let directory: string | undefined;

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('memory index settings', () => {
  it('persists only validated non-secret external index configuration', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'fpnf-memory-index-'));
    const store = new MemoryIndexConfigStore(directory);
    await store.set({
      semanticIndex: 'qdrant',
      relationshipIndex: 'neo4j',
      qdrantUrl: 'http://127.0.0.1:6333',
      qdrantCollection: 'deskpet_test',
      neo4jUrl: 'https://neo4j.example.com',
      neo4jDatabase: 'neo4j',
      neo4jUsername: 'fake-user',
    });
    expect(await new MemoryIndexConfigStore(directory).get()).toEqual({
      semanticIndex: 'qdrant',
      relationshipIndex: 'neo4j',
      qdrantUrl: 'http://127.0.0.1:6333',
      qdrantCollection: 'deskpet_test',
      neo4jUrl: 'https://neo4j.example.com',
      neo4jDatabase: 'neo4j',
      neo4jUsername: 'fake-user',
    });
  });

  it('rejects remote plaintext HTTP and masked secrets in Main-side parsing', () => {
    expect(() =>
      parseSetMemorySettingsInput({
        automaticMemoryEnabled: true,
        semanticIndex: 'qdrant',
        qdrantUrl: 'http://example.com:6333',
        qdrantCollection: 'deskpet',
        qdrantApiKey: '********',
      }),
    ).toThrow();
  });
});
