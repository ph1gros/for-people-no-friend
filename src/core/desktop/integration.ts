export const DESKTOP_ACTIONS = [
  'toggle-visibility',
  'stop-generation',
  'toggle-mute',
  'media-play-pause',
  'media-next',
  'media-previous',
] as const;

export type DesktopAction = (typeof DESKTOP_ACTIONS)[number];
export type MediaCommand = 'play-pause' | 'next' | 'previous';

export interface DesktopShortcutBinding {
  accelerator: string;
  action: DesktopAction;
}

export interface MediaSessionState {
  supported: boolean;
  playing?: boolean;
  title?: string;
  artist?: string;
  source?: string;
}

export interface MediaController {
  getState(): Promise<MediaSessionState>;
  send(command: MediaCommand): Promise<boolean>;
}

const SAFE_ACCELERATOR = /^(?=(?:.*(?:CommandOrControl|Ctrl|Alt|Shift)){2,})[A-Za-z0-9+]+$/;

export const validateShortcutBindings = (
  bindings: readonly DesktopShortcutBinding[],
): DesktopShortcutBinding[] => {
  if (bindings.length > 12) throw new Error('Too many desktop shortcuts.');
  const seen = new Set<string>();
  return bindings.map((binding) => {
    if (
      !SAFE_ACCELERATOR.test(binding.accelerator) ||
      !DESKTOP_ACTIONS.includes(binding.action) ||
      seen.has(binding.accelerator.toLowerCase())
    ) {
      throw new Error('The desktop shortcut is invalid.');
    }
    seen.add(binding.accelerator.toLowerCase());
    return { ...binding };
  });
};

export interface ExtensionCapabilityManifest {
  version: 1;
  id: string;
  kind: 'provider' | 'character-source' | 'performance-map' | 'media' | 'shortcut';
  permissions: Array<'network' | 'media-control' | 'global-shortcut'>;
  timeoutMs: number;
}

export const validateExtensionCapabilityManifest = (
  value: unknown,
): ExtensionCapabilityManifest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The extension capability manifest is invalid.');
  }
  const record = value as Record<string, unknown>;
  const kinds = ['provider', 'character-source', 'performance-map', 'media', 'shortcut'];
  const permissions = ['network', 'media-control', 'global-shortcut'];
  if (
    record.version !== 1 ||
    typeof record.id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(record.id) ||
    typeof record.kind !== 'string' ||
    !kinds.includes(record.kind) ||
    !Array.isArray(record.permissions) ||
    record.permissions.length > 3 ||
    !record.permissions.every(
      (permission) => typeof permission === 'string' && permissions.includes(permission),
    ) ||
    typeof record.timeoutMs !== 'number' ||
    !Number.isInteger(record.timeoutMs) ||
    record.timeoutMs < 100 ||
    record.timeoutMs > 30_000
  ) {
    throw new Error('The extension capability manifest is invalid.');
  }
  return {
    version: 1,
    id: record.id,
    kind: record.kind as ExtensionCapabilityManifest['kind'],
    permissions: [...new Set(record.permissions)] as ExtensionCapabilityManifest['permissions'],
    timeoutMs: record.timeoutMs,
  };
};
