import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { WorkGlossaryEntry } from '../../core/conversation/work-glossary';

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
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath(workId), 'utf8'),
      ) as WorkGlossaryCacheFile;
      return parsed.version === 1 && parsed.workId === workId && Array.isArray(parsed.entries)
        ? parsed
        : undefined;
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') {
        return undefined;
      }
      return undefined;
    }
  }

  public async set(workId: string, entries: WorkGlossaryEntry[]): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const filePath = this.filePath(workId);
    const temporaryPath = `${filePath}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ version: 1, workId, syncedAt: Date.now(), entries } satisfies WorkGlossaryCacheFile, null, 2)}\n`,
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
