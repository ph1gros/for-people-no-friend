import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_CHARACTER_PROFILE,
  type CharacterProfile,
  validateCharacterProfile,
} from '../../core/conversation/character-profile';

interface CharacterProfileFile {
  version: 1;
  profile: CharacterProfile;
}

export class CharacterProfileStore {
  private readonly filePath: string;

  public constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'character-profile.v1.json');
  }

  public async get(): Promise<CharacterProfile> {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      if (
        typeof value !== 'object' ||
        value === null ||
        !('version' in value) ||
        value.version !== 1 ||
        !('profile' in value)
      ) {
        throw new Error('The character profile file is invalid.');
      }
      return validateCharacterProfile(value.profile);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return { ...DEFAULT_CHARACTER_PROFILE };
      }
      throw error;
    }
  }

  public async set(profile: CharacterProfile): Promise<void> {
    const validated = validateCharacterProfile(profile);
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(
      temporaryPath,
      JSON.stringify({ version: 1, profile: validated } satisfies CharacterProfileFile, null, 2),
      { encoding: 'utf8', mode: 0o600 },
    );
    try {
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}
