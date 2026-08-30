import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  parseCharacterDisplayMode,
  type CharacterDisplayMode,
} from '../../shared/character-display-ipc';

interface CharacterDisplayConfigFile {
  version: 1;
  mode: CharacterDisplayMode;
}

export class CharacterDisplayConfigStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'character-display.v1.json');
  }

  public async get(): Promise<CharacterDisplayMode | undefined> {
    await this.writeQueue;
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        (value as Record<string, unknown>).version !== 1
      ) {
        throw new Error('The character display configuration is invalid.');
      }
      return parseCharacterDisplayMode((value as Record<string, unknown>).mode);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  public set(mode: CharacterDisplayMode): Promise<void> {
    const validated = parseCharacterDisplayMode(mode);
    const operation = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      const file: CharacterDisplayConfigFile = { version: 1, mode: validated };
      await writeFile(temporaryPath, JSON.stringify(file, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      try {
        await rename(temporaryPath, this.filePath);
      } catch (error) {
        await rm(temporaryPath, { force: true });
        throw error;
      }
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }
}
