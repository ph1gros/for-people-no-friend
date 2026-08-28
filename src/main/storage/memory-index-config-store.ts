import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseSetMemorySettingsInput } from '../../shared/memory-ipc';

export interface MemoryIndexConfiguration {
  semanticIndex: 'local' | 'qdrant';
  relationshipIndex: 'local' | 'neo4j';
  qdrantUrl: string;
  qdrantCollection: string;
  neo4jUrl: string;
  neo4jDatabase: string;
  neo4jUsername: string;
}

const defaults: MemoryIndexConfiguration = {
  semanticIndex: 'local',
  relationshipIndex: 'local',
  qdrantUrl: 'http://127.0.0.1:6333',
  qdrantCollection: 'deskpet_memories',
  neo4jUrl: 'http://127.0.0.1:7474',
  neo4jDatabase: 'neo4j',
  neo4jUsername: 'neo4j',
};

const isMissingFile = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

export class MemoryIndexConfigStore {
  private readonly filePath: string;

  public constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'memory-indexes.v1.json');
  }

  public async get(): Promise<MemoryIndexConfiguration> {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        (value as Record<string, unknown>).version !== 1
      )
        throw new Error();
      const parsed = parseSetMemorySettingsInput({
        automaticMemoryEnabled: false,
        ...(value as Record<string, unknown>),
      });
      return {
        semanticIndex: parsed.semanticIndex!,
        relationshipIndex: parsed.relationshipIndex!,
        qdrantUrl: parsed.qdrantUrl!,
        qdrantCollection: parsed.qdrantCollection!,
        neo4jUrl: parsed.neo4jUrl!,
        neo4jDatabase: parsed.neo4jDatabase!,
        neo4jUsername: parsed.neo4jUsername!,
      };
    } catch (error) {
      if (isMissingFile(error)) return { ...defaults };
      throw new Error('The memory index configuration is invalid.', { cause: error });
    }
  }

  public async set(configuration: MemoryIndexConfiguration): Promise<void> {
    const parsed = parseSetMemorySettingsInput({ automaticMemoryEnabled: false, ...configuration });
    const validated: MemoryIndexConfiguration = {
      semanticIndex: parsed.semanticIndex!,
      relationshipIndex: parsed.relationshipIndex!,
      qdrantUrl: parsed.qdrantUrl!,
      qdrantCollection: parsed.qdrantCollection!,
      neo4jUrl: parsed.neo4jUrl!,
      neo4jDatabase: parsed.neo4jDatabase!,
      neo4jUsername: parsed.neo4jUsername!,
    };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify({ version: 1, ...validated }, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    try {
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}
