import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  IRENA_CHARACTER_PROFILE,
  type CharacterProfile,
  validateCharacterProfile,
} from '../../core/conversation/character-profile';
import { resolveCharacterMemoryNamespace } from '../character/character-namespace';

interface CharacterProfilesFile {
  version: 1;
  activeProfileId: string;
  profiles: CharacterProfile[];
}

const isMissingFile = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

export class CharacterProfileStore {
  private readonly sharedProfilePath: string;
  private readonly filePath: string;
  private collection: CharacterProfilesFile | undefined;
  private loading: Promise<CharacterProfilesFile> | undefined;

  public constructor(userDataPath: string) {
    this.sharedProfilePath = path.join(userDataPath, 'character-profiles.v5.json');
    this.filePath = path.join(userDataPath, 'character-profiles.webp.v1.json');
  }

  public async get(): Promise<CharacterProfile> {
    const collection = await this.load();
    const profile = collection.profiles.find(({ id }) => id === collection.activeProfileId);
    if (!profile) throw new Error('The active character profile is missing.');
    return { ...profile };
  }

  public async set(profile: CharacterProfile): Promise<void> {
    const input = validateCharacterProfile(profile);
    const validated = validateCharacterProfile({
      ...input,
      memoryNamespace: resolveCharacterMemoryNamespace(input),
    });
    const collection = await this.load();
    if (validated.id !== collection.activeProfileId) {
      throw new Error('Only the active character profile can be updated.');
    }
    await this.saveCollection({
      ...collection,
      profiles: collection.profiles.map((existing) =>
        existing.id === validated.id ? validated : existing,
      ),
    });
  }

  private async load(): Promise<CharacterProfilesFile> {
    if (this.collection) return this.collection;
    this.loading ??= this.loadUncached().finally(() => {
      this.loading = undefined;
    });
    this.collection = await this.loading;
    return this.collection;
  }

  private async loadUncached(): Promise<CharacterProfilesFile> {
    try {
      const loaded = this.validateCollection(
        JSON.parse(await readFile(this.filePath, 'utf8')) as unknown,
      );
      const profile = loaded.profiles[0]!;
      const expectedNamespace = resolveCharacterMemoryNamespace(profile);
      if (profile.memoryNamespace !== expectedNamespace) {
        const migrated = {
          ...loaded,
          profiles: [{ ...profile, memoryNamespace: expectedNamespace }],
        };
        await this.saveCollection(migrated);
        return migrated;
      }
      return loaded;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }

    let profile = IRENA_CHARACTER_PROFILE;
    try {
      const shared = JSON.parse(await readFile(this.sharedProfilePath, 'utf8')) as unknown;
      if (typeof shared === 'object' && shared !== null && 'profiles' in shared) {
        const candidate = Array.isArray(shared.profiles)
          ? shared.profiles.find(
              (value) =>
                typeof value === 'object' &&
                value !== null &&
                'id' in value &&
                value.id === IRENA_CHARACTER_PROFILE.id,
            )
          : undefined;
        if (candidate) {
          const validated = validateCharacterProfile(candidate);
          profile = validateCharacterProfile({
            ...validated,
            memoryNamespace: resolveCharacterMemoryNamespace(validated),
          });
        }
      }
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    const collection: CharacterProfilesFile = {
      version: 1,
      activeProfileId: IRENA_CHARACTER_PROFILE.id,
      profiles: [profile],
    };
    await this.saveCollection(collection);
    return collection;
  }

  private validateCollection(value: unknown): CharacterProfilesFile {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      value.version !== 1 ||
      !('activeProfileId' in value) ||
      typeof value.activeProfileId !== 'string' ||
      !('profiles' in value) ||
      !Array.isArray(value.profiles) ||
      value.profiles.length !== 1
    ) {
      throw new Error('The character profiles file is invalid.');
    }
    const profiles = value.profiles.map(validateCharacterProfile);
    if (
      profiles[0]?.id !== IRENA_CHARACTER_PROFILE.id ||
      profiles[0].live2dModelId !== IRENA_CHARACTER_PROFILE.live2dModelId ||
      value.activeProfileId !== IRENA_CHARACTER_PROFILE.id
    ) {
      throw new Error('The character profiles file is invalid.');
    }
    return { version: 1, activeProfileId: value.activeProfileId, profiles };
  }

  private async saveCollection(collection: CharacterProfilesFile): Promise<void> {
    const validated = this.validateCollection(collection);
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    try {
      await rename(temporaryPath, this.filePath);
      this.collection = validated;
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}
