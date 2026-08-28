import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_VISIBILITY_SHORTCUT,
  parseDesktopIntegrationSettings,
  type DesktopIntegrationSettings,
} from '../../shared/desktop-integration-ipc';

const DEFAULT_SETTINGS: DesktopIntegrationSettings = {
  globalShortcutsEnabled: false,
  mediaControlEnabled: false,
  visibilityShortcut: DEFAULT_VISIBILITY_SHORTCUT,
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
        ((value as Record<string, unknown>).version !== 1 &&
          (value as Record<string, unknown>).version !== 2)
      ) {
        throw new Error('The desktop integration file is invalid.');
      }
      const record = value as Record<string, unknown>;
      if (record.version === 1) {
        return parseDesktopIntegrationSettings({
          ...(record.settings as Record<string, unknown>),
          visibilityShortcut: DEFAULT_VISIBILITY_SHORTCUT,
        });
      }
      return parseDesktopIntegrationSettings(record.settings);
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
    await writeFile(temporaryPath, JSON.stringify({ version: 2, settings: validated }, null, 2), {
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
