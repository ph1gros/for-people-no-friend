import {
  validateShortcutBindings,
  type MediaCommand,
  type MediaSessionState,
} from '../core/desktop/integration';

export const DEFAULT_VISIBILITY_SHORTCUT = '\\';
export const DEFAULT_STOP_GENERATION_SHORTCUT = 'Ctrl+Shift+Delete';
export const DEFAULT_INPUT_OVERLAY_KEYS = ['W', 'A', 'S', 'D'] as const;
export const MAX_INPUT_OVERLAY_KEYS = 24;
export const DESKTOP_WIDGET_IDS = ['input', 'media'] as const;
export type DesktopWidgetId = (typeof DESKTOP_WIDGET_IDS)[number];
export interface SetDesktopWidgetEnabledInput {
  widgetId: DesktopWidgetId;
  enabled: boolean;
}

export const SUPPORTED_INPUT_OVERLAY_KEYS = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'0123456789',
  'Space',
  'Shift',
  'Ctrl',
  'Alt',
  'Tab',
  'Enter',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backspace',
  'Delete',
  'PrintScreen',
  'ScrollLock',
  'NumLock',
  'Meta',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Insert',
  'CapsLock',
  'Backquote',
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Comma',
  'Period',
  'Slash',
  ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => `Numpad${index}`),
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadMultiply',
  'NumpadDivide',
  'NumpadDecimal',
  'NumpadEnter',
] as const;

export type InputOverlayKey = (typeof SUPPORTED_INPUT_OVERLAY_KEYS)[number];
export type MouseInputButton = 'left' | 'middle' | 'right';
export type MouseInputDirection =
  'up' | 'up-right' | 'right' | 'down-right' | 'down' | 'down-left' | 'left' | 'up-left';

export type DesktopInputActivityEvent =
  | { type: 'key'; key: InputOverlayKey; pressed: boolean }
  | { type: 'mouse-button'; button: MouseInputButton; pressed: boolean }
  | { type: 'mouse-direction'; direction: MouseInputDirection };

export interface DesktopIntegrationSettings {
  globalShortcutsEnabled: boolean;
  mediaControlEnabled: boolean;
  inputOverlayEnabled: boolean;
  inputOverlayMouseEnabled: boolean;
  inputOverlayKeys: InputOverlayKey[];
  widgetOrder: DesktopWidgetId[];
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
  inputOverlayActive: boolean;
  media: MediaSessionState;
}

const normalizeInputOverlayKey = (value: string): InputOverlayKey | undefined => {
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  const aliases: Readonly<Record<string, InputOverlayKey>> = {
    esc: 'Escape',
    control: 'Ctrl',
    return: 'Enter',
    spacebar: 'Space',
    '`': 'Backquote',
    '-': 'Minus',
    '=': 'Equal',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    '\\': 'Backslash',
    ';': 'Semicolon',
    "'": 'Quote',
    ',': 'Comma',
    '.': 'Period',
    '/': 'Slash',
  };
  if (aliases[normalized]) return aliases[normalized];
  return SUPPORTED_INPUT_OVERLAY_KEYS.find((key) => key.toLowerCase() === normalized);
};

export const tokenizeInputOverlayKeyDraft = (value: string): string[] =>
  value
    .split(/[,，、;；\s]+/u)
    .map((key) => key.trim())
    .filter(Boolean);

export const parseInputOverlayKeys = (value: unknown): InputOverlayKey[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_INPUT_OVERLAY_KEYS) {
    throw new Error('The input overlay key list is invalid.');
  }
  const keys = value.map((item) =>
    typeof item === 'string' ? normalizeInputOverlayKey(item) : undefined,
  );
  if (keys.some((key) => key === undefined)) {
    throw new Error('The input overlay key list contains an unsupported key.');
  }
  return [...new Set(keys as InputOverlayKey[])];
};

const parseWidgetOrder = (
  value: unknown,
  inputOverlayEnabled: boolean,
  mediaControlEnabled: boolean,
): DesktopWidgetId[] => {
  const fallbackOrder: DesktopWidgetId[] = ['input', 'media'];
  const enabled = new Set<DesktopWidgetId>([
    ...(inputOverlayEnabled ? (['input'] as const) : []),
    ...(mediaControlEnabled ? (['media'] as const) : []),
  ]);
  if (value === undefined) return fallbackOrder.filter((widget) => enabled.has(widget));
  if (
    !Array.isArray(value) ||
    value.length > DESKTOP_WIDGET_IDS.length ||
    !value.every(
      (widget) =>
        typeof widget === 'string' && DESKTOP_WIDGET_IDS.includes(widget as DesktopWidgetId),
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error('The desktop widget order is invalid.');
  }
  const ordered = (value as DesktopWidgetId[]).filter((widget) => enabled.has(widget));
  for (const widget of fallbackOrder) {
    if (enabled.has(widget) && !ordered.includes(widget)) ordered.push(widget);
  }
  return ordered;
};

export const parseDesktopIntegrationSettings = (value: unknown): DesktopIntegrationSettings => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).globalShortcutsEnabled !== 'boolean' ||
    typeof (value as Record<string, unknown>).mediaControlEnabled !== 'boolean' ||
    typeof (value as Record<string, unknown>).inputOverlayEnabled !== 'boolean' ||
    typeof (value as Record<string, unknown>).inputOverlayMouseEnabled !== 'boolean' ||
    typeof (value as Record<string, unknown>).visibilityShortcut !== 'string' ||
    typeof (value as Record<string, unknown>).stopGenerationShortcut !== 'string'
  ) {
    throw new Error('The desktop integration settings are invalid.');
  }
  const record = value as Record<string, unknown>;
  const inputOverlayEnabled = record.inputOverlayEnabled as boolean;
  const mediaControlEnabled = record.mediaControlEnabled as boolean;
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
    mediaControlEnabled,
    inputOverlayEnabled,
    inputOverlayMouseEnabled: record.inputOverlayMouseEnabled as boolean,
    inputOverlayKeys: parseInputOverlayKeys(record.inputOverlayKeys),
    widgetOrder: parseWidgetOrder(record.widgetOrder, inputOverlayEnabled, mediaControlEnabled),
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

export const parseSetDesktopWidgetEnabledInput = (value: unknown): SetDesktopWidgetEnabledInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The desktop widget toggle input is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.widgetId !== 'string' ||
    !DESKTOP_WIDGET_IDS.includes(record.widgetId as DesktopWidgetId) ||
    typeof record.enabled !== 'boolean' ||
    Object.keys(record).some((key) => key !== 'widgetId' && key !== 'enabled')
  ) {
    throw new Error('The desktop widget toggle input is invalid.');
  }
  return { widgetId: record.widgetId as DesktopWidgetId, enabled: record.enabled };
};

export const parseDesktopInputActivityEvent = (value: unknown): DesktopInputActivityEvent => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The desktop input activity event is invalid.');
  }
  const record = value as Record<string, unknown>;
  const hasOnlyKeys = (...allowed: readonly string[]): boolean =>
    Object.keys(record).every((key) => allowed.includes(key));
  if (record.type === 'key' && hasOnlyKeys('type', 'key', 'pressed')) {
    const [key] = parseInputOverlayKeys([record.key]);
    if (typeof record.pressed !== 'boolean') {
      throw new Error('The desktop input key state is invalid.');
    }
    return { type: 'key', key, pressed: record.pressed };
  }
  if (
    record.type === 'mouse-button' &&
    hasOnlyKeys('type', 'button', 'pressed') &&
    (record.button === 'left' || record.button === 'middle' || record.button === 'right') &&
    typeof record.pressed === 'boolean'
  ) {
    return { type: 'mouse-button', button: record.button, pressed: record.pressed };
  }
  if (
    record.type === 'mouse-direction' &&
    hasOnlyKeys('type', 'direction') &&
    (record.direction === 'up' ||
      record.direction === 'up-right' ||
      record.direction === 'right' ||
      record.direction === 'down-right' ||
      record.direction === 'down' ||
      record.direction === 'down-left' ||
      record.direction === 'left' ||
      record.direction === 'up-left')
  ) {
    return { type: 'mouse-direction', direction: record.direction };
  }
  throw new Error('The desktop input activity event is invalid.');
};
