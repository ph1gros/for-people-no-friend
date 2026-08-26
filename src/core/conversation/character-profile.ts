import type { CharacterLore, CharacterLoreSource } from '../character/character-lore';

export interface CharacterProfile {
  id: string;
  name: string;
  userDisplayName: string;
  bio: string;
  personaPrompt: string;
  live2dModelId: string;
  memoryNamespace: string;
  lore?: CharacterLore;
}

export const DEFAULT_CHARACTER_PROFILE: CharacterProfile = {
  id: 'default-character',
  name: '桌宠',
  userDisplayName: '你',
  bio: '陪伴在桌面上的 AI 角色。',
  personaPrompt: '保持自然、真诚、简洁的交流风格。不要假装拥有未提供的记忆或能力。',
  live2dModelId: 'local-model',
  memoryNamespace: 'default-character',
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const readLoreString = (record: Record<string, unknown>, key: string, maximum: number): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.length > maximum) {
    throw new Error(`The character lore field ${key} is invalid.`);
  }
  return value.trim();
};

const readLoreStringArray = (
  record: Record<string, unknown>,
  key: string,
  maximumItems: number,
  maximumLength: number,
): string[] => {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    value.length > maximumItems ||
    !value.every((item) => typeof item === 'string' && item.trim() && item.length <= maximumLength)
  ) {
    throw new Error(`The character lore field ${key} is invalid.`);
  }
  return [...new Set(value.map((item) => item.trim()))];
};

const validateLoreSource = (value: unknown): CharacterLoreSource => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The character lore source is invalid.');
  }
  const record = value as Record<string, unknown>;
  const id = readLoreString(record, 'id', 100);
  const title = readLoreString(record, 'title', 300);
  const url = readLoreString(record, 'url', 2_000);
  const siteName = readLoreString(record, 'siteName', 200);
  const retrievedAt = record.retrievedAt;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('The character lore source URL is invalid.');
  }
  if (
    !id ||
    !title ||
    !siteName ||
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.username ||
    parsedUrl.password ||
    typeof retrievedAt !== 'number' ||
    !Number.isFinite(retrievedAt) ||
    retrievedAt <= 0
  ) {
    throw new Error('The character lore source is invalid.');
  }
  return { id, title, url: parsedUrl.toString(), siteName, retrievedAt: Math.trunc(retrievedAt) };
};

const validateCharacterLore = (value: unknown): CharacterLore | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('The character lore is invalid.');
  }
  const record = value as Record<string, unknown>;
  const canonicalName = readLoreString(record, 'canonicalName', 120);
  if (!canonicalName) {
    throw new Error('The character lore is invalid.');
  }
  const sources = record.sources === undefined ? [] : record.sources;
  if (!Array.isArray(sources) || sources.length > 8) {
    throw new Error('The character lore sources are invalid.');
  }
  return {
    canonicalName,
    aliases: readLoreStringArray(record, 'aliases', 20, 120),
    sourceWork: readLoreString(record, 'sourceWork', 300),
    identity: readLoreString(record, 'identity', 1_000),
    personality: readLoreString(record, 'personality', 2_000),
    background: readLoreString(record, 'background', 4_000),
    relationships: readLoreStringArray(record, 'relationships', 20, 300),
    speechStyle: readLoreString(record, 'speechStyle', 2_000),
    sources: sources.map(validateLoreSource),
  };
};

export const validateCharacterProfile = (value: unknown): CharacterProfile => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The character profile is invalid.');
  }
  const record = value as Record<string, unknown>;
  const readString = (key: keyof CharacterProfile, maximum: number): string => {
    const candidate = record[key];
    if (
      typeof candidate !== 'string' ||
      candidate.trim().length === 0 ||
      candidate.length > maximum
    ) {
      throw new Error(`The character profile field ${key} is invalid.`);
    }
    return candidate.trim();
  };

  const id = readString('id', 64);
  const live2dModelId = readString('live2dModelId', 128);
  const memoryNamespace = readString('memoryNamespace', 64);
  if (!ID_PATTERN.test(id) || !ID_PATTERN.test(memoryNamespace)) {
    throw new Error('The character profile identifier is invalid.');
  }
  const lore = validateCharacterLore(record.lore);
  return {
    id,
    name: readString('name', 80),
    userDisplayName: readString('userDisplayName', 80),
    bio: readString('bio', 2_000),
    personaPrompt: readString('personaPrompt', 16_000),
    live2dModelId,
    memoryNamespace,
    ...(lore ? { lore } : {}),
  };
};
