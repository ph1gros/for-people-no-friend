import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  validateWorkGlossaryEntry,
  type WorkGlossaryEntry,
} from '../../core/conversation/work-glossary';

const WORK_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

interface WorkGlossaryCacheFile {
  version: 1;
  workId: string;
  syncedAt: number;
  entries: WorkGlossaryEntry[];
}

export class WorkGlossaryStore {
  private readonly directory: string;

  public constructor(userDataPath: string) {
    this.directory = path.join(userDataPath, 'work-glossaries');
  }

  public async get(workId: string): Promise<WorkGlossaryCacheFile | undefined> {
    if (!WORK_ID_PATTERN.test(workId)) return undefined;
    try {
      const parsed = JSON.parse(await readFile(this.filePath(workId), 'utf8')) as unknown;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('version' in parsed) ||
        parsed.version !== 1 ||
        !('workId' in parsed) ||
        parsed.workId !== workId ||
        !('syncedAt' in parsed) ||
        typeof parsed.syncedAt !== 'number' ||
        !Number.isFinite(parsed.syncedAt) ||
        parsed.syncedAt <= 0 ||
        !('entries' in parsed) ||
        !Array.isArray(parsed.entries) ||
        parsed.entries.length > 5_000
      ) {
        return undefined;
      }
      return {
        version: 1,
        workId,
        syncedAt: Math.trunc(parsed.syncedAt),
        entries: parsed.entries.map(validateWorkGlossaryEntry),
      };
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') {
        return undefined;
      }
      return undefined;
    }
  }

  public async set(workId: string, entries: WorkGlossaryEntry[]): Promise<void> {
    if (!WORK_ID_PATTERN.test(workId) || entries.length > 5_000) {
      throw new Error('The work glossary cache input is invalid.');
    }
    const validatedEntries = entries.map(validateWorkGlossaryEntry);
    await mkdir(this.directory, { recursive: true });
    const filePath = this.filePath(workId);
    const temporaryPath = `${filePath}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ version: 1, workId, syncedAt: Date.now(), entries: validatedEntries } satisfies WorkGlossaryCacheFile, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    try {
      await rename(temporaryPath, filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private filePath(workId: string): string {
    return path.join(this.directory, `${workId}.v1.json`);
  }
}
