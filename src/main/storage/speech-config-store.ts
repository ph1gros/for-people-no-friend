import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  BUNDLED_IREINA_SPEECH_PRESET,
  createInitialSpeechSettings,
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
  private readonly initialSettings: SpeechSettings;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(
    userDataPath: string,
    private readonly bundledVoiceAvailable = false,
  ) {
    this.filePath = path.join(userDataPath, 'speech.v1.json');
    this.initialSettings = createInitialSpeechSettings(bundledVoiceAvailable);
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
      const migratedSpeed =
        (version === 1 && parsed.speed === 1) || (version === 2 && parsed.speed === 0.95)
          ? { ...parsed, speed: DEFAULT_SPEECH_SETTINGS.speed }
          : parsed;
      const migratedModel =
        migratedSpeed.providerId === BUNDLED_IREINA_SPEECH_PRESET.providerId &&
        migratedSpeed.baseUrl === BUNDLED_IREINA_SPEECH_PRESET.baseUrl &&
        migratedSpeed.modelId === 'ireina' &&
        migratedSpeed.voiceId === BUNDLED_IREINA_SPEECH_PRESET.voiceId
          ? { ...migratedSpeed, modelId: BUNDLED_IREINA_SPEECH_PRESET.modelId }
          : migratedSpeed;
      const isUnavailableBundledDefault =
        !this.bundledVoiceAvailable &&
        !migratedModel.enabled &&
        migratedModel.providerId === BUNDLED_IREINA_SPEECH_PRESET.providerId &&
        migratedModel.baseUrl === BUNDLED_IREINA_SPEECH_PRESET.baseUrl &&
        migratedModel.modelId === BUNDLED_IREINA_SPEECH_PRESET.modelId &&
        migratedModel.voiceId === BUNDLED_IREINA_SPEECH_PRESET.voiceId;
      return isUnavailableBundledDefault ? { ...this.initialSettings } : migratedModel;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return { ...this.initialSettings };
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
