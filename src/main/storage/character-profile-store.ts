import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_CHARACTER_PROFILE,
  type CharacterProfile,
  type CharacterProfileOption,
  validateCharacterProfile,
} from '../../core/conversation/character-profile';

interface Live2DCharacterProfilesFile {
  version: 1;
  activeProfileId: string;
  profiles: CharacterProfile[];
}

const isMissingFile = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

export class CharacterProfileStore {
  private readonly sharedProfilePath: string;
  private readonly filePath: string;
  private collection: Live2DCharacterProfilesFile | undefined;
  private loading: Promise<Live2DCharacterProfilesFile> | undefined;

  public constructor(userDataPath: string) {
    this.sharedProfilePath = path.join(userDataPath, 'character-profiles.v5.json');
    this.filePath = path.join(userDataPath, 'character-profiles.live2d.v1.json');
  }

  public async get(): Promise<CharacterProfile> {
    const collection = await this.load();
    const profile = collection.profiles.find(({ id }) => id === collection.activeProfileId);
    if (!profile) throw new Error('The active Live2D character profile is missing.');
    return { ...profile };
  }

  public async list(): Promise<CharacterProfileOption[]> {
    const collection = await this.load();
    return collection.profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      appearanceId: profile.live2dModelId,
      active: profile.id === collection.activeProfileId,
    }));
  }

  public async activate(id: string): Promise<void> {
    const collection = await this.load();
    if (!collection.profiles.some((profile) => profile.id === id)) {
      throw new Error('Live2D character profile not found.');
    }
    await this.saveCollection({ ...collection, activeProfileId: id });
  }

  public async set(profile: CharacterProfile): Promise<void> {
    const validated = validateCharacterProfile(profile);
    const collection = await this.load();
    if (validated.id !== collection.activeProfileId || validated.live2dModelId !== 'local-model') {
      throw new Error('Only the active Live2D character profile can be updated.');
    }
    await this.saveCollection({ ...collection, profiles: [validated] });
  }

  private async load(): Promise<Live2DCharacterProfilesFile> {
    if (this.collection) return this.collection;
    this.loading ??= this.loadUncached().finally(() => {
      this.loading = undefined;
    });
    this.collection = await this.loading;
    return this.collection;
  }

  private async loadUncached(): Promise<Live2DCharacterProfilesFile> {
    try {
      return this.validateCollection(JSON.parse(await readFile(this.filePath, 'utf8')) as unknown);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }

    let profile = DEFAULT_CHARACTER_PROFILE;
    try {
      const shared = JSON.parse(await readFile(this.sharedProfilePath, 'utf8')) as unknown;
      if (typeof shared === 'object' && shared !== null && 'profiles' in shared) {
        const candidate = Array.isArray(shared.profiles)
          ? shared.profiles.find(
              (value) =>
                typeof value === 'object' &&
                value !== null &&
                'live2dModelId' in value &&
                value.live2dModelId === 'local-model',
            )
          : undefined;
        if (candidate) profile = validateCharacterProfile(candidate);
      }
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    const collection: Live2DCharacterProfilesFile = {
      version: 1,
      activeProfileId: profile.id,
      profiles: [profile],
    };
    await this.saveCollection(collection);
    return collection;
  }

  private validateCollection(value: unknown): Live2DCharacterProfilesFile {
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
      throw new Error('The Live2D character profile file is invalid.');
    }
    const profile = validateCharacterProfile(value.profiles[0]);
    if (profile.live2dModelId !== 'local-model' || profile.id !== value.activeProfileId) {
      throw new Error('The Live2D character profile file is invalid.');
    }
    return { version: 1, activeProfileId: value.activeProfileId, profiles: [profile] };
  }

  private async saveCollection(collection: Live2DCharacterProfilesFile): Promise<void> {
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
