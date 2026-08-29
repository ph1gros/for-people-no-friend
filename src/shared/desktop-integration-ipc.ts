import {
  validateShortcutBindings,
  type MediaCommand,
  type MediaSessionState,
} from '../core/desktop/integration';

export const DEFAULT_VISIBILITY_SHORTCUT = '\\';
export const DEFAULT_STOP_GENERATION_SHORTCUT = 'Ctrl+Shift+Delete';

export interface DesktopIntegrationSettings {
  globalShortcutsEnabled: boolean;
  mediaControlEnabled: boolean;
  visibilityShortcut: string;
  stopGenerationShortcut: string;
}

export interface SetDesktopIntegrationSettingsInput {
  settings: DesktopIntegrationSettings;
}

export interface MediaCommandInput {
  command: MediaCommand;
}

export interface DesktopIntegrationStatus {
  settings: DesktopIntegrationSettings;
  shortcutRegistered: boolean;
  stopGenerationShortcutRegistered: boolean;
  media: MediaSessionState;
}

export const parseDesktopIntegrationSettings = (value: unknown): DesktopIntegrationSettings => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).globalShortcutsEnabled !== 'boolean' ||
    typeof (value as Record<string, unknown>).mediaControlEnabled !== 'boolean' ||
    typeof (value as Record<string, unknown>).visibilityShortcut !== 'string' ||
    typeof (value as Record<string, unknown>).stopGenerationShortcut !== 'string'
  ) {
    throw new Error('The desktop integration settings are invalid.');
  }
  const record = value as Record<string, unknown>;
  const [visibilityShortcut, stopGenerationShortcut] = validateShortcutBindings([
    {
      accelerator: (record.visibilityShortcut as string).trim(),
      action: 'toggle-visibility',
    },
    {
      accelerator: (record.stopGenerationShortcut as string).trim(),
      action: 'stop-generation',
    },
  ]);
  return {
    globalShortcutsEnabled: record.globalShortcutsEnabled as boolean,
    mediaControlEnabled: record.mediaControlEnabled as boolean,
    visibilityShortcut: visibilityShortcut.accelerator,
    stopGenerationShortcut: stopGenerationShortcut.accelerator,
  };
};

export const parseSetDesktopIntegrationSettingsInput = (
  value: unknown,
): SetDesktopIntegrationSettingsInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The desktop integration settings input is invalid.');
  }
  return {
    settings: parseDesktopIntegrationSettings((value as Record<string, unknown>).settings),
  };
};

export const parseMediaCommandInput = (value: unknown): MediaCommandInput => {
  const command =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).command
      : undefined;
  if (command !== 'play-pause' && command !== 'next' && command !== 'previous') {
    throw new Error('The media command is invalid.');
  }
  return { command };
};
