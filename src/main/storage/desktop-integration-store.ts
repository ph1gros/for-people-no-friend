import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  parseDesktopIntegrationSettings,
  type DesktopIntegrationSettings,
} from '../../shared/desktop-integration-ipc';

const DEFAULT_SETTINGS: DesktopIntegrationSettings = {
  globalShortcutsEnabled: false,
  mediaControlEnabled: false,
};

export class DesktopIntegrationStore {
  private readonly filePath: string;

  public constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'desktop-integrations.v1.json');
  }

  public async get(): Promise<DesktopIntegrationSettings> {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        (value as Record<string, unknown>).version !== 1
      ) {
        throw new Error('The desktop integration file is invalid.');
      }
      return parseDesktopIntegrationSettings((value as Record<string, unknown>).settings);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return { ...DEFAULT_SETTINGS };
      }
      throw error;
    }
  }

  public async set(settings: DesktopIntegrationSettings): Promise<void> {
    const validated = parseDesktopIntegrationSettings(settings);
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify({ version: 1, settings: validated }, null, 2), {
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
