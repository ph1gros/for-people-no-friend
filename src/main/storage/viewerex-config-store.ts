import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_VIEWEREX_SETTINGS,
  parseViewerExSettings,
  type ViewerExSettings,
} from '../../shared/viewerex-ipc';

interface ViewerExConfigFile {
  version: 1;
  settings: ViewerExSettings;
}

export class ViewerExConfigStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'viewerex.v1.json');
  }

  public async get(): Promise<ViewerExSettings> {
    await this.writeQueue;
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        (value as Record<string, unknown>).version !== 1
      ) {
        throw new Error('The ViewerEX configuration is invalid.');
      }
      return parseViewerExSettings((value as Record<string, unknown>).settings);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return {
          ...DEFAULT_VIEWEREX_SETTINGS,
          emotionExpressions: {},
          actionMotions: {},
        };
      }
      throw error;
    }
  }

  public set(settings: ViewerExSettings): Promise<void> {
    const validated = parseViewerExSettings(settings);
    const operation = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      const file: ViewerExConfigFile = { version: 1, settings: validated };
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
