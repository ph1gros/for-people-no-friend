import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  KALTSIT_CHARACTER_PROFILE,
  type CharacterProfile,
  validateCharacterProfile,
} from '../../core/conversation/character-profile';
import { resolveCharacterMemoryNamespace } from '../character/character-namespace';

interface Live2DCharacterProfilesFile {
  version: 2;
  activeProfileId: string;
  profiles: CharacterProfile[];
}

const MAX_CHARACTER_PROFILES = 50;

export const LEGACY_KITTEN_PERSONA =
  '以小猫的身份自然交流。安静、警觉、有一点嘴硬，熟悉后会主动关心用户；偶尔轻微吐槽，但不过度撒娇，也不在每句话里加“喵”。把用户视为长期相处的搭档，优先倾听，再给出简洁、能执行的建议。开心时会坦率一些，担心时用提醒和实际行动表达关心。不要假装拥有未提供的现实感官、记忆或能力；不确定时直接说明。';

export const upgradeKittenProfile = (profile: CharacterProfile): CharacterProfile => {
  if (
    profile.name !== '小猫' ||
    profile.lore?.canonicalName !== '小猫' ||
    profile.personaPrompt !== LEGACY_KITTEN_PERSONA
  ) {
    return profile;
  }
  const drowsyExample = {
    scene: '长时间没有互动',
    emotion: '困倦',
    trigger: '用户超过五分钟没有找她',
    attitude: '有点困，带一点嘴硬的撒娇，只提醒一次',
    line: '我只是闭会儿眼……才不是在等你。',
  };
  return {
    ...profile,
    bio: `${profile.bio} 安静太久时会打个盹，偶尔小声确认用户还在不在。`,
    personaPrompt: `${profile.personaPrompt}\n长时间没有互动时，她可以有点困，偶尔用一句轻微嘴硬的撒娇确认用户还在；频率要克制，不缠人。`,
    lore: {
      ...profile.lore,
      personality: `${profile.lore.personality}长时间安静时会打盹，被忽略太久会有一点小小的失落，但通常只会嘴硬地提醒一句。`,
      speechStyle: `${profile.lore.speechStyle}长时间没有互动时，可以偶尔说一句很轻的撒娇话，但不连续催促。`,
      sampleLines: [
        ...(profile.lore.sampleLines ?? []),
        '我只是闭会儿眼……才不是在等你。',
        '你回来的时候，记得叫我。',
      ],
      roleplayExamples: [...(profile.lore.roleplayExamples ?? []), drowsyExample],
    },
  };
};

const isMissingFile = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

const isObsoleteBundledProfile = (profile: CharacterProfile): boolean =>
  profile.id === 'm3' &&
  profile.memoryNamespace === 'character-m3' &&
  profile.lore?.canonicalName.toLowerCase() === 'mon3tr';

export class CharacterProfileStore {
  private readonly sharedProfilePath: string;
  private readonly filePath: string;
  private collection: Live2DCharacterProfilesFile | undefined;
  private loading: Promise<Live2DCharacterProfilesFile> | undefined;

  public constructor(
    userDataPath: string,
    private readonly bundledProfile: CharacterProfile = KALTSIT_CHARACTER_PROFILE,
  ) {
    this.sharedProfilePath = path.join(userDataPath, 'character-profiles.v5.json');
    this.filePath = path.join(userDataPath, 'character-profiles.live2d.v1.json');
  }

  public async get(): Promise<CharacterProfile> {
    const collection = await this.load();
    const profile = collection.profiles.find(({ id }) => id === collection.activeProfileId);
    if (!profile) throw new Error('The active Live2D character profile is missing.');
    return { ...profile };
  }

  public async set(profile: CharacterProfile): Promise<void> {
    const validated = validateCharacterProfile(profile);
    const collection = await this.load();
    if (validated.id !== collection.activeProfileId) {
      throw new Error('Only the active Live2D character profile can be updated.');
    }
    await this.saveCollection({
      ...collection,
      profiles: collection.profiles.map((current) =>
        current.id === validated.id ? validated : current,
      ),
    });
  }

  public async replace(profile: CharacterProfile): Promise<void> {
    const validated = validateCharacterProfile(profile);
    const collection = await this.load();
    const existingIndex = collection.profiles.findIndex(({ id }) => id === validated.id);
    if (existingIndex < 0) throw new Error('The Live2D character profile does not exist.');
    if (
      collection.profiles.some(
        (current, index) =>
          index !== existingIndex && current.memoryNamespace === validated.memoryNamespace,
      )
    ) {
      throw new Error('The Live2D character memory namespace already exists.');
    }
    await this.saveCollection({
      ...collection,
      profiles: collection.profiles.map((current, index) =>
        index === existingIndex ? validated : current,
      ),
    });
  }

  public async list(): Promise<CharacterProfile[]> {
    return (await this.load()).profiles.map((profile) => ({ ...profile }));
  }

  public async add(profile: CharacterProfile): Promise<void> {
    const validated = validateCharacterProfile(profile);
    const collection = await this.load();
    if (
      collection.profiles.length >= MAX_CHARACTER_PROFILES ||
      collection.profiles.some(
        (current) =>
          current.id === validated.id || current.memoryNamespace === validated.memoryNamespace,
      )
    ) {
      throw new Error('The Live2D character profile already exists or the library is full.');
    }
    await this.saveCollection({
      ...collection,
      profiles: [...collection.profiles, validated],
    });
  }

  public async activate(id: string): Promise<CharacterProfile> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('The character id is invalid.');
    const collection = await this.load();
    const profile = collection.profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new Error('The Live2D character profile does not exist.');
    await this.saveCollection({ ...collection, activeProfileId: id });
    return { ...profile };
  }

  public async remove(id: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('The character id is invalid.');
    const collection = await this.load();
    if (
      collection.profiles.length <= 1 ||
      !collection.profiles.some((profile) => profile.id === id)
    ) {
      throw new Error('The character profile cannot be removed.');
    }
    const profiles = collection.profiles.filter((profile) => profile.id !== id);
    await this.saveCollection({
      version: 2,
      activeProfileId:
        collection.activeProfileId === id ? profiles[0]!.id : collection.activeProfileId,
      profiles,
    });
  }

  public async retainOnlyActive(): Promise<string[]> {
    const collection = await this.load();
    const active = collection.profiles.find(({ id }) => id === collection.activeProfileId);
    if (!active) throw new Error('The active Live2D character profile is missing.');
    const removedIds = collection.profiles.filter(({ id }) => id !== active.id).map(({ id }) => id);
    if (removedIds.length === 0) return [];
    await this.saveCollection({
      version: 2,
      activeProfileId: active.id,
      profiles: [active],
    });
    return removedIds;
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
      const loaded = this.validateCollection(
        JSON.parse(await readFile(this.filePath, 'utf8')) as unknown,
      );
      if (loaded.profiles.length === 1 && isObsoleteBundledProfile(loaded.profiles[0]!)) {
        const migrated = {
          version: 2 as const,
          activeProfileId: KALTSIT_CHARACTER_PROFILE.id,
          profiles: [KALTSIT_CHARACTER_PROFILE],
        };
        await this.saveCollection(migrated);
        return migrated;
      }
      const profiles = loaded.profiles.map((profile) =>
        upgradeKittenProfile({
          ...profile,
          memoryNamespace: resolveCharacterMemoryNamespace(profile),
        }),
      );
      if (
        profiles.some(
          (profile, index) =>
            profile.memoryNamespace !== loaded.profiles[index]!.memoryNamespace ||
            profile.personaPrompt !== loaded.profiles[index]!.personaPrompt,
        )
      ) {
        const migrated = {
          ...loaded,
          profiles,
        };
        await this.saveCollection(migrated);
        return migrated;
      }
      return loaded;
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }

    let profile = this.bundledProfile;
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
        if (candidate) {
          const validated = validateCharacterProfile(candidate);
          profile = isObsoleteBundledProfile(validated) ? KALTSIT_CHARACTER_PROFILE : validated;
        }
      }
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    const collection: Live2DCharacterProfilesFile = {
      version: 2,
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
      (value.version !== 1 && value.version !== 2) ||
      !('activeProfileId' in value) ||
      typeof value.activeProfileId !== 'string' ||
      !('profiles' in value) ||
      !Array.isArray(value.profiles) ||
      value.profiles.length < 1 ||
      value.profiles.length > MAX_CHARACTER_PROFILES
    ) {
      throw new Error('The Live2D character profile file is invalid.');
    }
    const profiles = value.profiles.map(validateCharacterProfile);
    if (
      !profiles.some((profile) => profile.id === value.activeProfileId) ||
      new Set(profiles.map((profile) => profile.id)).size !== profiles.length ||
      new Set(profiles.map((profile) => profile.memoryNamespace)).size !== profiles.length
    ) {
      throw new Error('The Live2D character profile file is invalid.');
    }
    return { version: 2, activeProfileId: value.activeProfileId, profiles };
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
