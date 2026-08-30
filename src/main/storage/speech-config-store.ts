import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_SPEECH_SETTINGS,
  parseSpeechSettings,
  type SpeechSettings,
} from '../../shared/speech-ipc';

interface SpeechConfigFile {
  version: 3;
  settings: SpeechSettings;
}

export class SpeechConfigStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'speech.v1.json');
  }

  public async get(): Promise<SpeechSettings> {
    await this.writeQueue;
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        ![1, 2, 3].includes((value as Record<string, unknown>).version as number)
      ) {
        throw new Error('The speech configuration is invalid.');
      }
      const parsed = parseSpeechSettings((value as Record<string, unknown>).settings);
      const version = (value as Record<string, unknown>).version;
      return (version === 1 && parsed.speed === 1) || (version === 2 && parsed.speed === 0.95)
        ? { ...parsed, speed: DEFAULT_SPEECH_SETTINGS.speed }
        : parsed;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return { ...DEFAULT_SPEECH_SETTINGS };
      }
      throw error;
    }
  }

  public set(settings: SpeechSettings): Promise<void> {
    const validated = parseSpeechSettings(settings);
    const operation = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      const file: SpeechConfigFile = { version: 3, settings: validated };
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
