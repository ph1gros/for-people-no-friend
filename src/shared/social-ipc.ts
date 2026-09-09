import {
  SOCIAL_CONNECTION_STATES,
  SOCIAL_ID_PATTERN,
  type SocialConnectionState,
} from '../core/social/social-contracts';
import { MAX_SOCIAL_OWNER_ACCOUNTS } from '../core/social/social-account-config';
import { parseCharacterIdInput } from './character-package-ipc';

export type { SocialConnectionState };

export const SOCIAL_IPC_CHANNELS = Object.freeze({
  getQqPresence: 'deskpet:social-qq:get',
  saveQqPresence: 'deskpet:social-qq:save',
  connectQqPresence: 'deskpet:social-qq:connect',
  disconnectQqPresence: 'deskpet:social-qq:disconnect',
  deleteQqSecret: 'deskpet:social-qq:delete-secret',
  getKookPresence: 'deskpet:social-kook:get',
  saveKookPresence: 'deskpet:social-kook:save',
  connectKookPresence: 'deskpet:social-kook:connect',
  disconnectKookPresence: 'deskpet:social-kook:disconnect',
  deleteKookSecret: 'deskpet:social-kook:delete-secret',
  controlKookVoice: 'deskpet:social-kook:voice',
  getOopzPresence: 'deskpet:social-oopz:get',
  saveOopzPresence: 'deskpet:social-oopz:save',
  startOopzBridge: 'deskpet:social-oopz:start-bridge',
  stopOopzBridge: 'deskpet:social-oopz:stop-bridge',
  connectOopzPresence: 'deskpet:social-oopz:connect',
  disconnectOopzPresence: 'deskpet:social-oopz:disconnect',
  deleteOopzSecret: 'deskpet:social-oopz:delete-secret',
});

/** This is the only configuration shape returned to the renderer. */
export interface QqPresenceConfiguration {
  characterId: string;
  appId: string;
  enabled: boolean;
  ownerBindingCount: number;
  hasSecret: boolean;
  /** Reply with a native voice message. Requires the optional SILK codec at connect time. */
  voiceReplyEnabled: boolean;
}

export interface QqCharacterInput {
  characterId: string;
}

export interface QqSettingsInput extends QqCharacterInput {
  appId: string;
  enabled: boolean;
  /** Omit to preserve the encrypted credential. Use deleteQqSecret to remove it. */
  appSecret?: string;
  /** Write-only: omission preserves bindings; an empty array explicitly clears them. */
  ownerUserIds?: string[];
  /** Omit to preserve the stored preference. */
  voiceReplyEnabled?: boolean;
}

export type SaveQqPresenceInput = QqSettingsInput;

export interface QqPresenceSnapshot {
  configuration: QqPresenceConfiguration;
  state: SocialConnectionState;
  errorMessage?: string;
}

export interface QqPresenceApi {
  getQqPresence(): Promise<QqPresenceSnapshot>;
  saveQqPresence(input: QqSettingsInput): Promise<QqPresenceSnapshot>;
  connectQqPresence(input: QqCharacterInput): Promise<QqPresenceSnapshot>;
  disconnectQqPresence(input: QqCharacterInput): Promise<QqPresenceSnapshot>;
  deleteQqSecret(input: QqCharacterInput): Promise<QqPresenceSnapshot>;
}

export type DeskpetSocialApi = QqPresenceApi & KookPresenceApi & OopzPresenceApi;

export const QQ_PRESENCE_PUBLIC_ERROR =
  'QQ presence is unavailable. Please check the configuration and try again.';

const invalid = (): never => {
  throw new Error('The social presence input is invalid.');
};

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
};

export const parseQqCharacterInput = (value: unknown): QqCharacterInput =>
  parseCharacterIdInput(value);

const parseAppId = (value: unknown): string => {
  if (typeof value !== 'string' || (value !== '' && !/^[0-9]{5,32}$/.test(value))) {
    return invalid();
  }
  return value;
};

export const parseQqSettingsInput = (value: unknown): QqSettingsInput => {
  const candidate = record(value);
  const { characterId } = parseQqCharacterInput(candidate);
  const appId = parseAppId(candidate.appId);
  if (candidate.enabled !== undefined && typeof candidate.enabled !== 'boolean') invalid();
  const input: QqSettingsInput = { characterId, appId, enabled: candidate.enabled === true };

  if (candidate.voiceReplyEnabled !== undefined) {
    if (typeof candidate.voiceReplyEnabled !== 'boolean') return invalid();
    input.voiceReplyEnabled = candidate.voiceReplyEnabled;
  }

  if (candidate.appSecret !== undefined) {
    const secret = candidate.appSecret;
    if (
      typeof secret !== 'string' ||
      secret.length > 32_768 ||
      secret.trim().length === 0 ||
      /^[*\u2022]+$/.test(secret.trim()) ||
      /\p{Cc}/u.test(secret)
    ) {
      return invalid();
    }
    input.appSecret = secret.trim();
  }

  if (candidate.ownerUserIds !== undefined) {
    const owners = candidate.ownerUserIds;
    if (!Array.isArray(owners) || owners.length > MAX_SOCIAL_OWNER_ACCOUNTS) return invalid();
    const parsed: string[] = [];
    for (const owner of owners) {
      // QQ open IDs may be opaque strings rather than decimal QQ account numbers.
      if (typeof owner !== 'string' || !SOCIAL_ID_PATTERN.test(owner)) return invalid();
      parsed.push(owner);
    }
    input.ownerUserIds = [...new Set(parsed)];
  }
  return input;
};

export const parseSaveQqPresenceInput = parseQqSettingsInput;

export const parseQqPresenceConfiguration = (value: unknown): QqPresenceConfiguration => {
  const candidate = record(value);
  const { characterId } = parseQqCharacterInput(candidate);
  const appId = parseAppId(candidate.appId);
  if (
    typeof candidate.enabled !== 'boolean' ||
    typeof candidate.hasSecret !== 'boolean' ||
    typeof candidate.voiceReplyEnabled !== 'boolean' ||
    typeof candidate.ownerBindingCount !== 'number' ||
    !Number.isInteger(candidate.ownerBindingCount) ||
    candidate.ownerBindingCount < 0 ||
    candidate.ownerBindingCount > MAX_SOCIAL_OWNER_ACCOUNTS
  ) {
    return invalid();
  }
  return {
    characterId,
    appId,
    enabled: candidate.enabled,
    ownerBindingCount: candidate.ownerBindingCount,
    hasSecret: candidate.hasSecret,
    voiceReplyEnabled: candidate.voiceReplyEnabled,
  };
};

/** Also used in Main so accidental controller fields cannot cross the IPC boundary. */
export const parseQqPresenceSnapshot = (value: unknown): QqPresenceSnapshot => {
  const candidate = record(value);
  if (
    typeof candidate.state !== 'string' ||
    !(SOCIAL_CONNECTION_STATES as readonly string[]).includes(candidate.state) ||
    (candidate.errorMessage !== undefined && typeof candidate.errorMessage !== 'string')
  ) {
    return invalid();
  }
  return {
    configuration: parseQqPresenceConfiguration(candidate.configuration),
    state: candidate.state as SocialConnectionState,
    // Never relay provider errors, even when a controller forgot to redact one.
    ...(candidate.state === 'error' ? { errorMessage: QQ_PRESENCE_PUBLIC_ERROR } : {}),
  };
};

// ---------------------------------------------------------------------------
// KOOK presence
// ---------------------------------------------------------------------------

/** This is the only KOOK configuration shape returned to the renderer. */
export interface KookPresenceConfiguration {
  characterId: string;
  enabled: boolean;
  ownerBindingCount: number;
  hasToken: boolean;
}

export interface KookSettingsInput extends QqCharacterInput {
  enabled: boolean;
  /** Omit to preserve the encrypted credential. Use deleteKookSecret to remove it. */
  botToken?: string;
  /** Write-only: omission preserves bindings; an empty array explicitly clears them. */
  ownerUserIds?: string[];
}

export interface KookPresenceSnapshot {
  configuration: KookPresenceConfiguration;
  state: SocialConnectionState;
  errorMessage?: string;
}

export interface KookPresenceApi {
  controlKookVoice?(input: KookVoiceInput): Promise<KookPresenceSnapshot>;
  getKookPresence(): Promise<KookPresenceSnapshot>;
  saveKookPresence(input: KookSettingsInput): Promise<KookPresenceSnapshot>;
  connectKookPresence(input: QqCharacterInput): Promise<KookPresenceSnapshot>;
  disconnectKookPresence(input: QqCharacterInput): Promise<KookPresenceSnapshot>;
  deleteKookSecret(input: QqCharacterInput): Promise<KookPresenceSnapshot>;
}

export type KookVoiceInput = QqCharacterInput &
  ({ action: 'join'; channelId: string } | { action: 'speak'; text: string } | { action: 'leave' });

export function parseKookVoiceInput(value: unknown): KookVoiceInput {
  const candidate = record(value);
  const { characterId } = parseQqCharacterInput(candidate);
  if (candidate.action === 'leave') return { characterId, action: 'leave' };
  if (
    candidate.action === 'join' &&
    typeof candidate.channelId === 'string' &&
    /^[0-9]{1,32}$/u.test(candidate.channelId)
  ) {
    return { characterId, action: 'join', channelId: candidate.channelId };
  }
  if (
    candidate.action === 'speak' &&
    typeof candidate.text === 'string' &&
    candidate.text.trim() &&
    candidate.text.length <= 1000
  ) {
    return { characterId, action: 'speak', text: candidate.text.trim() };
  }
  return invalid();
}

export const KOOK_PRESENCE_PUBLIC_ERROR =
  'KOOK presence is unavailable. Please check the configuration and try again.';

const MAX_KOOK_TOKEN_LENGTH = 512;

export const parseKookSettingsInput = (value: unknown): KookSettingsInput => {
  const candidate = record(value);
  const { characterId } = parseQqCharacterInput(candidate);
  if (candidate.enabled !== undefined && typeof candidate.enabled !== 'boolean') invalid();
  const input: KookSettingsInput = { characterId, enabled: candidate.enabled === true };

  if (candidate.botToken !== undefined) {
    const token = candidate.botToken;
    if (
      typeof token !== 'string' ||
      token.length > MAX_KOOK_TOKEN_LENGTH ||
      token.trim().length < 8 ||
      /^[*\u2022]+$/.test(token.trim()) ||
      /\p{Cc}/u.test(token) ||
      /\s/u.test(token.trim())
    ) {
      return invalid();
    }
    input.botToken = token.trim();
  }

  if (candidate.ownerUserIds !== undefined) {
    const owners = candidate.ownerUserIds;
    if (!Array.isArray(owners) || owners.length > MAX_SOCIAL_OWNER_ACCOUNTS) return invalid();
    const parsed: string[] = [];
    for (const owner of owners) {
      if (typeof owner !== 'string' || !SOCIAL_ID_PATTERN.test(owner)) return invalid();
      parsed.push(owner);
    }
    input.ownerUserIds = [...new Set(parsed)];
  }
  return input;
};

export const parseKookPresenceConfiguration = (value: unknown): KookPresenceConfiguration => {
  const candidate = record(value);
  const { characterId } = parseQqCharacterInput(candidate);
  if (
    typeof candidate.enabled !== 'boolean' ||
    typeof candidate.hasToken !== 'boolean' ||
    typeof candidate.ownerBindingCount !== 'number' ||
    !Number.isInteger(candidate.ownerBindingCount) ||
    candidate.ownerBindingCount < 0 ||
    candidate.ownerBindingCount > MAX_SOCIAL_OWNER_ACCOUNTS
  ) {
    return invalid();
  }
  return {
    characterId,
    enabled: candidate.enabled,
    ownerBindingCount: candidate.ownerBindingCount,
    hasToken: candidate.hasToken,
  };
};

/** Also used in Main so accidental controller fields cannot cross the IPC boundary. */
export const parseKookPresenceSnapshot = (value: unknown): KookPresenceSnapshot => {
  const candidate = record(value);
  if (
    typeof candidate.state !== 'string' ||
    !(SOCIAL_CONNECTION_STATES as readonly string[]).includes(candidate.state)
  ) {
    return invalid();
  }
  return {
    configuration: parseKookPresenceConfiguration(candidate.configuration),
    state: candidate.state as SocialConnectionState,
    // The upstream detail is dropped on purpose: it may carry credential diagnostics.
    ...(candidate.errorMessage === undefined ? {} : { errorMessage: KOOK_PRESENCE_PUBLIC_ERROR }),
  };
};

// ---------------------------------------------------------------------------
// Oopz presence (experimental community bridge)
//
// Oopz has one layer more than the official platforms: a bridge process, and a OneBot connection
// to it. Both states are surfaced separately because they fail independently - a running process
// does not mean the bridge logged in, and a stopped one makes connecting pointless.
// ---------------------------------------------------------------------------

export const OOPZ_BRIDGE_STATES = ['stopped', 'starting', 'running', 'stopping', 'error'] as const;

export type OopzBridgeProcessState = (typeof OOPZ_BRIDGE_STATES)[number];

export interface OopzPresenceConfiguration {
  characterId: string;
  enabled: boolean;
  /** Loopback OneBot endpoint of the bridge. Empty until the user configures one. */
  onebotUrl: string;
  ownerBindingCount: number;
  hasCredentials: boolean;
  /** False until an audited bridge runtime is available; starting fails closed without one. */
  runtimeAvailable: boolean;
}

export interface OopzSettingsInput extends QqCharacterInput {
  enabled: boolean;
  onebotUrl?: string;
  /** Omit both to preserve the stored credential; supply both to replace it. */
  account?: string;
  password?: string;
  ownerUserIds?: string[];
  /** Saving credentials requires explicitly accepting the current experimental warning. */
  acceptedWarningVersion?: number;
}

export interface OopzPresenceSnapshot {
  configuration: OopzPresenceConfiguration;
  /** Bridge process liveness. Running does NOT mean logged in or OneBot-ready. */
  bridge: OopzBridgeProcessState;
  /** OneBot connection state, independent of the process above. */
  state: SocialConnectionState;
  errorMessage?: string;
}

export interface OopzStartInput extends QqCharacterInput {
  acceptedWarningVersion: number;
}

export interface OopzPresenceApi {
  getOopzPresence(): Promise<OopzPresenceSnapshot>;
  saveOopzPresence(input: OopzSettingsInput): Promise<OopzPresenceSnapshot>;
  startOopzBridge(input: OopzStartInput): Promise<OopzPresenceSnapshot>;
  stopOopzBridge(input: QqCharacterInput): Promise<OopzPresenceSnapshot>;
  connectOopzPresence(input: QqCharacterInput): Promise<OopzPresenceSnapshot>;
  disconnectOopzPresence(input: QqCharacterInput): Promise<OopzPresenceSnapshot>;
  deleteOopzSecret(input: QqCharacterInput): Promise<OopzPresenceSnapshot>;
}

export const OOPZ_PRESENCE_PUBLIC_ERROR =
  'Oopz presence is unavailable. Please check the experimental configuration and try again.';

const LOOPBACK_ONEBOT_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const MAX_ONEBOT_URL_LENGTH = 2_048;

/**
 * Renderer-side shape check for the bridge endpoint. Main re-validates with the authoritative
 * parser before ever opening a socket; this exists so the settings page can refuse an obvious
 * mistake without reaching across the boundary.
 */
export const isLoopbackOneBotUrl = (value: string): boolean => {
  if (value.length === 0 || value.length > MAX_ONEBOT_URL_LENGTH) return false;
  if (/[\s]/u.test(value)) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
    return (
      (url.protocol === 'ws:' || url.protocol === 'wss:') &&
      LOOPBACK_ONEBOT_HOSTS.has(host) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
};

export const parseOopzStartInput = (value: unknown): OopzStartInput => {
  const candidate = record(value);
  const { characterId } = parseQqCharacterInput(candidate);
  if (
    typeof candidate.acceptedWarningVersion !== 'number' ||
    !Number.isInteger(candidate.acceptedWarningVersion) ||
    candidate.acceptedWarningVersion < 1
  ) {
    return invalid();
  }
  return { characterId, acceptedWarningVersion: candidate.acceptedWarningVersion };
};

export const parseOopzSettingsInput = (value: unknown): OopzSettingsInput => {
  const candidate = record(value);
  const { characterId } = parseQqCharacterInput(candidate);
  if (candidate.enabled !== undefined && typeof candidate.enabled !== 'boolean') invalid();
  const input: OopzSettingsInput = { characterId, enabled: candidate.enabled === true };

  if (candidate.onebotUrl !== undefined) {
    if (typeof candidate.onebotUrl !== 'string' || !isLoopbackOneBotUrl(candidate.onebotUrl)) {
      return invalid();
    }
    input.onebotUrl = candidate.onebotUrl;
  }

  // Account and password travel together: half a credential is never stored.
  const hasAccount = candidate.account !== undefined;
  const hasPassword = candidate.password !== undefined;
  if (hasAccount !== hasPassword) return invalid();
  if (hasAccount) {
    const account = candidate.account;
    const password = candidate.password;
    if (
      typeof account !== 'string' ||
      !/^\+?[0-9]{5,20}$/u.test(account) ||
      typeof password !== 'string' ||
      password.length < 1 ||
      password.length > 256 ||
      !password.trim() ||
      /^[*\u2022]+$/u.test(password) ||
      /\p{Cc}/u.test(password)
    ) {
      return invalid();
    }
    // Password whitespace is significant; never trim it.
    input.account = account;
    input.password = password;
    if (
      typeof candidate.acceptedWarningVersion !== 'number' ||
      !Number.isInteger(candidate.acceptedWarningVersion) ||
      candidate.acceptedWarningVersion < 1
    ) {
      return invalid();
    }
    input.acceptedWarningVersion = candidate.acceptedWarningVersion;
  }

  if (candidate.ownerUserIds !== undefined) {
    const owners = candidate.ownerUserIds;
    if (!Array.isArray(owners) || owners.length > MAX_SOCIAL_OWNER_ACCOUNTS) return invalid();
    const parsed: string[] = [];
    for (const owner of owners) {
      if (typeof owner !== 'string' || !SOCIAL_ID_PATTERN.test(owner)) return invalid();
      parsed.push(owner);
    }
    input.ownerUserIds = [...new Set(parsed)];
  }
  return input;
};

export const parseOopzPresenceConfiguration = (value: unknown): OopzPresenceConfiguration => {
  const candidate = record(value);
  const { characterId } = parseQqCharacterInput(candidate);
  if (
    typeof candidate.enabled !== 'boolean' ||
    typeof candidate.hasCredentials !== 'boolean' ||
    typeof candidate.runtimeAvailable !== 'boolean' ||
    typeof candidate.onebotUrl !== 'string' ||
    candidate.onebotUrl.length > MAX_ONEBOT_URL_LENGTH ||
    (candidate.onebotUrl !== '' && !isLoopbackOneBotUrl(candidate.onebotUrl)) ||
    typeof candidate.ownerBindingCount !== 'number' ||
    !Number.isInteger(candidate.ownerBindingCount) ||
    candidate.ownerBindingCount < 0 ||
    candidate.ownerBindingCount > MAX_SOCIAL_OWNER_ACCOUNTS
  ) {
    return invalid();
  }
  return {
    characterId,
    enabled: candidate.enabled,
    onebotUrl: candidate.onebotUrl,
    ownerBindingCount: candidate.ownerBindingCount,
    hasCredentials: candidate.hasCredentials,
    runtimeAvailable: candidate.runtimeAvailable,
  };
};

/** Also used in Main so accidental controller fields cannot cross the IPC boundary. */
export const parseOopzPresenceSnapshot = (value: unknown): OopzPresenceSnapshot => {
  const candidate = record(value);
  if (
    typeof candidate.state !== 'string' ||
    !(SOCIAL_CONNECTION_STATES as readonly string[]).includes(candidate.state) ||
    typeof candidate.bridge !== 'string' ||
    !(OOPZ_BRIDGE_STATES as readonly string[]).includes(candidate.bridge)
  ) {
    return invalid();
  }
  return {
    configuration: parseOopzPresenceConfiguration(candidate.configuration),
    bridge: candidate.bridge as OopzBridgeProcessState,
    state: candidate.state as SocialConnectionState,
    // The upstream detail is dropped on purpose: it may carry credential diagnostics.
    ...(candidate.errorMessage === undefined ? {} : { errorMessage: OOPZ_PRESENCE_PUBLIC_ERROR }),
  };
};
