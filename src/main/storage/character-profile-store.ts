import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_CHARACTER_PROFILE,
  IRENA_CHARACTER_PROFILE,
  type CharacterProfile,
  type CharacterProfileOption,
  validateCharacterProfile,
} from '../../core/conversation/character-profile';

interface LegacyCharacterProfileFile {
  version: 1;
  profile: CharacterProfile;
}

interface CharacterProfilesFile {
  version: 5;
  activeProfileId: string;
  profiles: CharacterProfile[];
}

const isMissingFile = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

export class CharacterProfileStore {
  private readonly legacyFilePath: string;
  private readonly version2FilePath: string;
  private readonly version3FilePath: string;
  private readonly version4FilePath: string;
  private readonly filePath: string;

  public constructor(userDataPath: string) {
    this.legacyFilePath = path.join(userDataPath, 'character-profile.v1.json');
    this.version2FilePath = path.join(userDataPath, 'character-profiles.v2.json');
    this.version3FilePath = path.join(userDataPath, 'character-profiles.v3.json');
    this.version4FilePath = path.join(userDataPath, 'character-profiles.v4.json');
    this.filePath = path.join(userDataPath, 'character-profiles.v5.json');
  }

  public async get(): Promise<CharacterProfile> {
    const collection = await this.load();
    const profile = collection.profiles.find(({ id }) => id === collection.activeProfileId);
    if (!profile) throw new Error('The active character profile is missing.');
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
      throw new Error('Character profile not found.');
    }
    await this.saveCollection({ ...collection, activeProfileId: id });
  }

  public async set(profile: CharacterProfile): Promise<void> {
    const validated = validateCharacterProfile(profile);
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
    try {
      return this.validateCollection(JSON.parse(await readFile(this.filePath, 'utf8')) as unknown);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }

    for (const previousPath of [
      this.version4FilePath,
      this.version3FilePath,
      this.version2FilePath,
    ]) {
      try {
        const collection = this.validateCollection(
          JSON.parse(await readFile(previousPath, 'utf8')) as unknown,
        );
        await this.saveCollection(collection);
        return collection;
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }

    let existing = { ...DEFAULT_CHARACTER_PROFILE };
    try {
      const legacy = JSON.parse(
        await readFile(this.legacyFilePath, 'utf8'),
      ) as LegacyCharacterProfileFile;
      if (legacy.version !== 1) throw new Error('The legacy character profile file is invalid.');
      existing = validateCharacterProfile(legacy.profile);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    const profiles = [existing];
    if (existing.id !== IRENA_CHARACTER_PROFILE.id) {
      profiles.push({ ...IRENA_CHARACTER_PROFILE });
    }
    return { version: 5, activeProfileId: existing.id, profiles };
  }

  private validateCollection(value: unknown): CharacterProfilesFile {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      (value.version !== 2 && value.version !== 3 && value.version !== 4 && value.version !== 5) ||
      !('activeProfileId' in value) ||
      typeof value.activeProfileId !== 'string' ||
      !('profiles' in value) ||
      !Array.isArray(value.profiles) ||
      value.profiles.length === 0 ||
      value.profiles.length > 16
    ) {
      throw new Error('The character profiles file is invalid.');
    }
    let profiles = value.profiles.map(validateCharacterProfile);
    if (
      new Set(profiles.map(({ id }) => id)).size !== profiles.length ||
      !profiles.some(({ id }) => id === value.activeProfileId)
    ) {
      throw new Error('The character profiles file is invalid.');
    }
    if (value.version === 2) {
      profiles = profiles.map((profile) =>
        profile.id === IRENA_CHARACTER_PROFILE.id &&
        profile.live2dModelId === IRENA_CHARACTER_PROFILE.live2dModelId &&
        profile.memoryNamespace === IRENA_CHARACTER_PROFILE.memoryNamespace &&
        !profile.lore
          ? { ...profile, lore: IRENA_CHARACTER_PROFILE.lore }
          : profile,
      );
    }
    if (value.version <= 3) {
      profiles = profiles.map((profile) =>
        profile.id === IRENA_CHARACTER_PROFILE.id &&
        profile.live2dModelId === IRENA_CHARACTER_PROFILE.live2dModelId &&
        profile.memoryNamespace === IRENA_CHARACTER_PROFILE.memoryNamespace &&
        profile.lore?.sources.some(({ id }) => id === 'majotabi-official-character') &&
        profile.lore.sampleLines?.length === 0
          ? {
              ...profile,
              lore: { ...profile.lore, sampleLines: IRENA_CHARACTER_PROFILE.lore?.sampleLines },
            }
          : profile,
      );
    }
    if (value.version <= 4) {
      profiles = profiles.map((profile) =>
        profile.id === IRENA_CHARACTER_PROFILE.id &&
        profile.live2dModelId === IRENA_CHARACTER_PROFILE.live2dModelId &&
        profile.memoryNamespace === IRENA_CHARACTER_PROFILE.memoryNamespace &&
        profile.lore?.sources.some(({ id }) => id === 'majotabi-official-character') &&
        profile.lore.roleplayExamples?.length === 0
          ? {
              ...profile,
              lore: {
                ...profile.lore,
                roleplayExamples: IRENA_CHARACTER_PROFILE.lore?.roleplayExamples,
              },
            }
          : profile,
      );
    }
    return { version: 5, activeProfileId: value.activeProfileId, profiles };
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
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}
