import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_VTUBE_STUDIO_SETTINGS,
  parseVTubeStudioSettings,
  type VTubeStudioSettings,
} from '../../shared/vtube-studio-ipc';

interface VTubeStudioConfigFile {
  version: 1;
  settings: VTubeStudioSettings;
}

export class VTubeStudioConfigStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'vtube-studio.v1.json');
  }

  public async get(): Promise<VTubeStudioSettings> {
    await this.writeQueue;
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        (value as Record<string, unknown>).version !== 1
      ) {
        throw new Error('The VTube Studio configuration is invalid.');
      }
      return parseVTubeStudioSettings((value as Record<string, unknown>).settings);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return { ...DEFAULT_VTUBE_STUDIO_SETTINGS };
      }
      throw error;
    }
  }

  public set(settings: VTubeStudioSettings): Promise<void> {
    const validated = parseVTubeStudioSettings(settings);
    const operation = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      const file: VTubeStudioConfigFile = { version: 1, settings: validated };
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
