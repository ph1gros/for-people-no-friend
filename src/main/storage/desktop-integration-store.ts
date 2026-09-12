import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_INPUT_OVERLAY_KEYS,
  DEFAULT_STOP_GENERATION_SHORTCUT,
  DEFAULT_VISIBILITY_SHORTCUT,
  parseDesktopIntegrationSettings,
  DESKTOP_WIDGET_IDS,
  type DesktopIntegrationSettings,
} from '../../shared/desktop-integration-ipc';

const DEFAULT_SETTINGS: DesktopIntegrationSettings = {
  globalShortcutsEnabled: false,
  mediaControlEnabled: false,
  inputOverlayEnabled: false,
  inputOverlayMouseEnabled: true,
  inputOverlayKeys: [...DEFAULT_INPUT_OVERLAY_KEYS],
  widgetOrder: [],
  visibilityShortcut: DEFAULT_VISIBILITY_SHORTCUT,
  stopGenerationShortcut: DEFAULT_STOP_GENERATION_SHORTCUT,
};

export class DesktopIntegrationStore {
  private readonly filePath: string;

  public constructor(
    userDataPath: string,
    private readonly knownIds: () => readonly string[] = () => DESKTOP_WIDGET_IDS,
  ) {
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
          (value as Record<string, unknown>).version !== 2 &&
          (value as Record<string, unknown>).version !== 3 &&
          (value as Record<string, unknown>).version !== 4 &&
          (value as Record<string, unknown>).version !== 5 &&
          (value as Record<string, unknown>).version !== 6)
      ) {
        throw new Error('The desktop integration file is invalid.');
      }
      const record = value as Record<string, unknown>;
      if (record.version === 1 || record.version === 2 || record.version === 3) {
        return parseDesktopIntegrationSettings({
          ...(record.settings as Record<string, unknown>),
          ...(record.version === 1 ? { visibilityShortcut: DEFAULT_VISIBILITY_SHORTCUT } : {}),
          stopGenerationShortcut: DEFAULT_STOP_GENERATION_SHORTCUT,
          inputOverlayEnabled: false,
          inputOverlayMouseEnabled: true,
          inputOverlayKeys: [...DEFAULT_INPUT_OVERLAY_KEYS],
        });
      }
      if (
        record.version === 6 &&
        record.settings &&
        typeof record.settings === 'object' &&
        !Array.isArray(record.settings)
      ) {
        const stored = record.settings as Record<string, unknown>;
        const ids = Array.isArray(stored.declarativeWidgetIds)
          ? stored.declarativeWidgetIds.filter((id): id is string => typeof id === 'string')
          : [];
        const parsed = parseDesktopIntegrationSettings(stored, [...this.knownIds(), ...ids]);
        // Missing optional packages must not discard the user's built-in desktop settings.
        parsed.declarativeWidgetIds = parsed.declarativeWidgetIds?.filter((id) =>
          this.knownIds().includes(id),
        );
        parsed.widgetOrder = parsed.widgetOrder.filter((id) => this.knownIds().includes(id));
        return parsed;
      }
      return parseDesktopIntegrationSettings(record.settings, this.knownIds());
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return { ...DEFAULT_SETTINGS };
      }
      throw error;
    }
  }

  public async set(settings: DesktopIntegrationSettings): Promise<void> {
    const validated = parseDesktopIntegrationSettings(settings, this.knownIds());
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify({ version: 6, settings: validated }, null, 2), {
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
