import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { MAX_SOCIAL_OWNER_ACCOUNTS, socialSecretId } from '../../core/social/social-account-config';
import {
  isLoopbackOneBotUrl,
  parseKookSettingsInput,
  parseQqCharacterInput,
  parseQqSettingsInput,
  parseOopzSettingsInput,
  type KookPresenceConfiguration,
  type KookSettingsInput,
  type OopzSettingsInput,
  type QqPresenceConfiguration,
  type QqSettingsInput,
} from '../../shared/social-ipc';
import type { SecretStore } from '../security/secret-store';
import { createSocialIdHasher, createSocialInstallationSalt } from './social-identity-hasher';

interface StoredQqConfiguration {
  appId: string;
  enabled: boolean;
  ownerTokens: string[];
  voiceReplyEnabled: boolean;
}

interface StoredKookConfiguration {
  enabled: boolean;
  ownerTokens: string[];
}

/** Oopz credentials live with the bridge manager; only non-secret settings are stored here. */
interface StoredOopzConfiguration {
  enabled: boolean;
  onebotUrl: string;
  ownerTokens: string[];
}

interface SocialConfigFile {
  version: 1;
  identitySalt: string;
  qq: Record<string, StoredQqConfiguration>;
  kook: Record<string, StoredKookConfiguration>;
  oopz: Record<string, StoredOopzConfiguration>;
}

/** The half of the Oopz configuration this store owns; credentials belong to the bridge manager. */
export interface OopzStoredSettings {
  characterId: string;
  enabled: boolean;
  onebotUrl: string;
  ownerBindingCount: number;
}

export interface QqCredentials {
  appId: string;
  appSecret: string;
}

const MAX_FILE_BYTES = 1_048_576;
const MAX_CHARACTERS = 1_024;
const queues = new Map<string, Promise<unknown>>();
const invalid = (): never => {
  throw new Error('The social configuration store is invalid.');
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));

const defaults = (): StoredQqConfiguration => ({
  appId: '',
  enabled: false,
  ownerTokens: [],
  voiceReplyEnabled: false,
});

const parseFile = (text: string): SocialConfigFile => {
  const value: unknown = JSON.parse(text);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['version', 'identitySalt', 'qq', 'kook', 'oopz']) ||
    value.version !== 1 ||
    typeof value.identitySalt !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.identitySalt) ||
    !isRecord(value.qq) ||
    Object.keys(value.qq).length > MAX_CHARACTERS
  ) {
    return invalid();
  }
  const qq: SocialConfigFile['qq'] = Object.create(null);
  for (const [characterId, stored] of Object.entries(value.qq)) {
    if (
      !isRecord(stored) ||
      !hasOnlyKeys(stored, ['appId', 'enabled', 'ownerTokens', 'voiceReplyEnabled']) ||
      typeof stored.enabled !== 'boolean' ||
      !Array.isArray(stored.ownerTokens) ||
      stored.ownerTokens.length > MAX_SOCIAL_OWNER_ACCOUNTS
    ) {
      return invalid();
    }
    const parsed = parseQqSettingsInput({
      characterId,
      appId: stored.appId,
      enabled: stored.enabled,
    });
    const ownerTokens: string[] = [];
    for (const token of stored.ownerTokens) {
      if (typeof token !== 'string' || !/^[a-f0-9]{24}$/.test(token)) return invalid();
      ownerTokens.push(token);
    }
    if (new Set(ownerTokens).size !== ownerTokens.length) return invalid();
    qq[characterId] = {
      appId: parsed.appId,
      enabled: parsed.enabled,
      ownerTokens,
      // Absent in files written before voice replies existed: those stay off.
      voiceReplyEnabled: stored.voiceReplyEnabled === true,
    };
  }
  const kook: SocialConfigFile['kook'] = Object.create(null);
  if (value.kook !== undefined) {
    if (!isRecord(value.kook) || Object.keys(value.kook).length > MAX_CHARACTERS) return invalid();
    for (const [characterId, stored] of Object.entries(value.kook)) {
      if (
        !isRecord(stored) ||
        !hasOnlyKeys(stored, ['enabled', 'ownerTokens']) ||
        typeof stored.enabled !== 'boolean' ||
        !Array.isArray(stored.ownerTokens) ||
        stored.ownerTokens.length > MAX_SOCIAL_OWNER_ACCOUNTS
      ) {
        return invalid();
      }
      const { characterId: parsedId } = parseQqCharacterInput({ characterId });
      const ownerTokens: string[] = [];
      for (const token of stored.ownerTokens) {
        if (typeof token !== 'string' || !/^[a-f0-9]{24}$/.test(token)) return invalid();
        ownerTokens.push(token);
      }
      if (new Set(ownerTokens).size !== ownerTokens.length) return invalid();
      kook[parsedId] = { enabled: stored.enabled, ownerTokens };
    }
  }
  const oopz: SocialConfigFile['oopz'] = Object.create(null);
  if (value.oopz !== undefined) {
    if (!isRecord(value.oopz) || Object.keys(value.oopz).length > MAX_CHARACTERS) return invalid();
    for (const [characterId, stored] of Object.entries(value.oopz)) {
      if (
        !isRecord(stored) ||
        !hasOnlyKeys(stored, ['enabled', 'onebotUrl', 'ownerTokens']) ||
        typeof stored.enabled !== 'boolean' ||
        typeof stored.onebotUrl !== 'string' ||
        (stored.onebotUrl !== '' && !isLoopbackOneBotUrl(stored.onebotUrl)) ||
        !Array.isArray(stored.ownerTokens) ||
        stored.ownerTokens.length > MAX_SOCIAL_OWNER_ACCOUNTS
      ) {
        return invalid();
      }
      const { characterId: parsedId } = parseQqCharacterInput({ characterId });
      const ownerTokens: string[] = [];
      for (const token of stored.ownerTokens) {
        if (typeof token !== 'string' || !/^[a-f0-9]{24}$/.test(token)) return invalid();
        ownerTokens.push(token);
      }
      if (new Set(ownerTokens).size !== ownerTokens.length) return invalid();
      oopz[parsedId] = {
        enabled: stored.enabled,
        onebotUrl: stored.onebotUrl,
        ownerTokens,
      };
    }
  }
  return { version: 1, identitySalt: value.identitySalt, qq, kook, oopz };
};

const secretSlot = (characterId: string): string => platformSecretSlot('qq', characterId);

/** Secret store IDs are capped at 64 characters, so the digest fills whatever the prefix leaves. */
const platformSecretSlot = (platform: 'qq' | 'kook', characterId: string): string => {
  const base =
    platform === 'qq' ? socialSecretId('qq', 'app-secret') : socialSecretId('kook', 'bot-token');
  const suffix = createHash('sha256').update(characterId, 'utf8').digest('hex');
  return `${base}-${suffix.slice(0, 64 - base.length - 1)}`;
};

const kookDefaults = (): StoredKookConfiguration => ({ enabled: false, ownerTokens: [] });

const oopzDefaults = (): StoredOopzConfiguration => ({
  enabled: false,
  onebotUrl: '',
  ownerTokens: [],
});

/** Main-only storage. All operations, including first salt creation, share a per-path queue. */
export class SocialConfigStore {
  private readonly filePath: string;
  private readonly queueKey: string;
  private identitySalt: string | undefined;

  public constructor(
    userDataPath: string,
    private readonly secrets: Pick<SecretStore, 'get' | 'set' | 'has' | 'delete'>,
  ) {
    this.filePath = path.resolve(userDataPath, 'social-config.v1.json');
    this.queueKey = process.platform === 'win32' ? this.filePath.toLowerCase() : this.filePath;
  }

  public async get(characterId: string): Promise<QqPresenceConfiguration> {
    const parsed = parseQqCharacterInput({ characterId });
    return this.serialize(async () => {
      const file = await this.read();
      return this.snapshot(
        parsed.characterId,
        file,
        await this.secrets.has(secretSlot(characterId)),
      );
    });
  }

  public async save(input: QqSettingsInput): Promise<QqPresenceConfiguration> {
    // Copy validated input before queueing so callers cannot change the target while awaiting I/O.
    const parsed = parseQqSettingsInput(input);
    return this.serialize(async () => {
      const file = await this.read();
      const previous = file.qq[parsed.characterId] ?? defaults();
      const appChanged = parsed.appId !== previous.appId;
      if (
        !Object.hasOwn(file.qq, parsed.characterId) &&
        Object.keys(file.qq).length >= MAX_CHARACTERS
      ) {
        return invalid();
      }
      const hash = createSocialIdHasher(file.identitySalt);
      file.qq[parsed.characterId] = {
        appId: parsed.appId,
        enabled: parsed.enabled,
        ownerTokens:
          parsed.ownerUserIds === undefined
            ? appChanged
              ? []
              : previous.ownerTokens
            : parsed.ownerUserIds.map((owner) => hash('qq', owner)),
        voiceReplyEnabled: parsed.voiceReplyEnabled ?? previous.voiceReplyEnabled,
      };
      const slot = secretSlot(parsed.characterId);
      // QQ open IDs and credentials belong to the App ID, so changing it resets enrollment.
      const changeSecret = parsed.appSecret !== undefined || appChanged;
      const hasSecret = changeSecret
        ? parsed.appSecret !== undefined
        : await this.secrets.has(slot);
      let previousSecret: string | undefined;
      if (changeSecret) {
        previousSecret = await this.secrets.get(slot);
        if (parsed.appSecret === undefined) await this.secrets.delete(slot);
        else await this.secrets.set(slot, parsed.appSecret);
      }
      try {
        await this.write(file);
      } catch (error) {
        if (changeSecret) {
          if (previousSecret === undefined) await this.secrets.delete(slot);
          else await this.secrets.set(slot, previousSecret);
        }
        throw error;
      }
      return this.snapshot(parsed.characterId, file, hasSecret);
    });
  }

  public async deleteSecret(characterId: string): Promise<QqPresenceConfiguration> {
    const parsed = parseQqCharacterInput({ characterId });
    return this.serialize(async () => {
      const file = await this.read();
      await this.secrets.delete(secretSlot(parsed.characterId));
      return this.snapshot(parsed.characterId, file, false);
    });
  }

  public async getCredentials(characterId: string): Promise<QqCredentials | undefined> {
    const parsed = parseQqCharacterInput({ characterId });
    return this.serialize(async () => {
      const file = await this.read();
      const appId = file.qq[parsed.characterId]?.appId;
      if (!appId) return undefined;
      const appSecret = await this.secrets.get(secretSlot(parsed.characterId));
      return appSecret ? { appId, appSecret } : undefined;
    });
  }

  public async getIdentitySalt(): Promise<string> {
    return this.serialize(async () => (await this.read()).identitySalt);
  }

  public async getOwnerTokens(characterId: string): Promise<string[]> {
    const parsed = parseQqCharacterInput({ characterId });
    return this.serialize(async () => {
      const file = await this.read();
      // No default owner, including when the account has no explicit bindings.
      return [...(file.qq[parsed.characterId]?.ownerTokens ?? [])];
    });
  }

  public async getKook(characterId: string): Promise<KookPresenceConfiguration> {
    const parsed = parseQqCharacterInput({ characterId });
    return this.serialize(async () => {
      const file = await this.read();
      return this.kookSnapshot(
        parsed.characterId,
        file,
        await this.secrets.has(platformSecretSlot('kook', parsed.characterId)),
      );
    });
  }

  public async saveKook(input: KookSettingsInput): Promise<KookPresenceConfiguration> {
    // Copy validated input before queueing so callers cannot change the target while awaiting I/O.
    const parsed = parseKookSettingsInput(input);
    return this.serialize(async () => {
      const file = await this.read();
      const previous = file.kook[parsed.characterId] ?? kookDefaults();
      if (
        !Object.hasOwn(file.kook, parsed.characterId) &&
        Object.keys(file.kook).length >= MAX_CHARACTERS
      ) {
        return invalid();
      }
      const hash = createSocialIdHasher(file.identitySalt);
      file.kook[parsed.characterId] = {
        enabled: parsed.enabled,
        // A rotated bot token is still the same character: owner bindings name users, not bots.
        ownerTokens:
          parsed.ownerUserIds === undefined
            ? previous.ownerTokens
            : parsed.ownerUserIds.map((owner) => hash('kook', owner)),
      };
      const slot = platformSecretSlot('kook', parsed.characterId);
      const hasToken = parsed.botToken !== undefined ? true : await this.secrets.has(slot);
      let previousToken: string | undefined;
      if (parsed.botToken !== undefined) {
        previousToken = await this.secrets.get(slot).catch(() => undefined);
        await this.secrets.set(slot, parsed.botToken);
      }
      try {
        await this.write(file);
      } catch (error) {
        // Roll the credential back so the stored token can never outlive its configuration.
        if (parsed.botToken !== undefined) {
          if (previousToken === undefined) await this.secrets.delete(slot).catch(() => undefined);
          else await this.secrets.set(slot, previousToken).catch(() => undefined);
        }
        throw error;
      }
      return this.kookSnapshot(parsed.characterId, file, hasToken);
    });
  }

  public async deleteKookSecret(characterId: string): Promise<KookPresenceConfiguration> {
    const parsed = parseQqCharacterInput({ characterId });
    return this.serialize(async () => {
      await this.secrets.delete(platformSecretSlot('kook', parsed.characterId));
      return this.kookSnapshot(parsed.characterId, await this.read(), false);
    });
  }

  public async getKookToken(characterId: string): Promise<string | undefined> {
    const parsed = parseQqCharacterInput({ characterId });
    return this.serialize(async () =>
      this.secrets.get(platformSecretSlot('kook', parsed.characterId)),
    );
  }

  public async getKookOwnerTokens(characterId: string): Promise<string[]> {
    const parsed = parseQqCharacterInput({ characterId });
    return this.serialize(async () => {
      const file = await this.read();
      // No default owner, including when the account has no explicit bindings.
      return [...(file.kook[parsed.characterId]?.ownerTokens ?? [])];
    });
  }

  public async getOopz(characterId: string): Promise<OopzStoredSettings> {
    const parsed = parseQqCharacterInput({ characterId });
    return this.serialize(async () => this.oopzSnapshot(parsed.characterId, await this.read()));
  }

  public async saveOopz(input: OopzSettingsInput): Promise<OopzStoredSettings> {
    // Copy validated input before queueing so callers cannot change the target while awaiting I/O.
    const parsed = parseOopzSettingsInput(input);
    return this.serialize(async () => {
      const file = await this.read();
      const previous = file.oopz[parsed.characterId] ?? oopzDefaults();
      if (
        !Object.hasOwn(file.oopz, parsed.characterId) &&
        Object.keys(file.oopz).length >= MAX_CHARACTERS
      ) {
        return invalid();
      }
      const hash = createSocialIdHasher(file.identitySalt);
      file.oopz[parsed.characterId] = {
        enabled: parsed.enabled,
        onebotUrl: parsed.onebotUrl ?? previous.onebotUrl,
        // Rotating the bridge account is still the same character: bindings name users, not bots.
        ownerTokens:
          parsed.ownerUserIds === undefined
            ? previous.ownerTokens
            : parsed.ownerUserIds.map((owner) => hash('oopz', owner)),
      };
      await this.write(file);
      return this.oopzSnapshot(parsed.characterId, file);
    });
  }

  public async getOopzOwnerTokens(characterId: string): Promise<string[]> {
    const parsed = parseQqCharacterInput({ characterId });
    return this.serialize(async () => {
      const file = await this.read();
      // No default owner, including when the account has no explicit bindings.
      return [...(file.oopz[parsed.characterId]?.ownerTokens ?? [])];
    });
  }

  private oopzSnapshot(characterId: string, file: SocialConfigFile): OopzStoredSettings {
    const configuration = file.oopz[characterId] ?? oopzDefaults();
    return {
      characterId,
      enabled: configuration.enabled,
      onebotUrl: configuration.onebotUrl,
      ownerBindingCount: configuration.ownerTokens.length,
    };
  }

  private kookSnapshot(
    characterId: string,
    file: SocialConfigFile,
    hasToken: boolean,
  ): KookPresenceConfiguration {
    const configuration = file.kook[characterId] ?? kookDefaults();
    return {
      characterId,
      enabled: configuration.enabled,
      ownerBindingCount: configuration.ownerTokens.length,
      hasToken,
    };
  }

  private snapshot(
    characterId: string,
    file: SocialConfigFile,
    hasSecret: boolean,
  ): QqPresenceConfiguration {
    const configuration = file.qq[characterId] ?? defaults();
    return {
      characterId,
      appId: configuration.appId,
      enabled: configuration.enabled,
      ownerBindingCount: configuration.ownerTokens.length,
      hasSecret,
      voiceReplyEnabled: configuration.voiceReplyEnabled,
    };
  }

  private async read(): Promise<SocialConfigFile> {
    let handle;
    try {
      handle = await open(this.filePath, 'r');
    } catch (error) {
      if (isRecord(error) && error.code === 'ENOENT' && this.identitySalt === undefined) {
        const file: SocialConfigFile = {
          version: 1,
          identitySalt: createSocialInstallationSalt(),
          qq: Object.create(null),
          kook: Object.create(null),
          oopz: Object.create(null),
        };
        await this.write(file);
        this.identitySalt = file.identitySalt;
        return file;
      }
      throw new Error('The social configuration store could not be read.', { cause: error });
    }
    try {
      if ((await handle.stat()).size > MAX_FILE_BYTES) return invalid();
      const text = await handle.readFile('utf8');
      if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) return invalid();
      const file = parseFile(text);
      if (this.identitySalt !== undefined && file.identitySalt !== this.identitySalt)
        return invalid();
      this.identitySalt = file.identitySalt;
      return file;
    } catch {
      // Corruption is never treated as a new installation or written over.
      return invalid();
    } finally {
      await handle.close();
    }
  }

  private async write(file: SocialConfigFile): Promise<void> {
    const text = JSON.stringify(file, null, 2);
    if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) return invalid();
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, 'wx', 0o600);
    try {
      try {
        await handle.writeFile(text, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = (queues.get(this.queueKey) ?? Promise.resolve()).then(task);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    queues.set(this.queueKey, settled);
    void settled.then(() => {
      if (queues.get(this.queueKey) === settled) queues.delete(this.queueKey);
    });
    return next;
  }
}
