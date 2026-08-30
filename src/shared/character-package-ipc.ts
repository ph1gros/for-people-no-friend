import type { CharacterProfile } from '../core/conversation/character-profile';

export interface CharacterLibraryEntry {
  profile: CharacterProfile;
  active: boolean;
  imported: boolean;
}

export interface CharacterPackagePreview {
  previewId: string;
  packageId: string;
  characterId: string;
  characterName: string;
  sourceWork?: string;
  assetCount: number;
  uncompressedBytes: number;
  hasLive2DModel: boolean;
  attribution: Array<{ title: string; url: string; licenseNote: string }>;
  conflict: 'none' | 'replace' | 'blocked';
}

export type CharacterPackageFileResult =
  | { ok: true; canceled: true }
  | { ok: true; canceled: false; preview?: CharacterPackagePreview }
  | { ok: false; canceled: false; message: string };

export interface ConfirmCharacterPackageImportInput {
  previewId: string;
  replaceExisting: boolean;
}

export interface CharacterIdInput {
  characterId: string;
}

export interface CreateLocalCharacterInput {
  name: string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PREVIEW_ID_PATTERN = /^[a-f0-9-]{36}$/;

export const parseConfirmCharacterPackageImportInput = (
  value: unknown,
): ConfirmCharacterPackageImportInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The character package confirmation is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.previewId !== 'string' ||
    !PREVIEW_ID_PATTERN.test(record.previewId) ||
    typeof record.replaceExisting !== 'boolean'
  ) {
    throw new Error('The character package confirmation is invalid.');
  }
  return { previewId: record.previewId, replaceExisting: record.replaceExisting };
};

export const parseCharacterIdInput = (value: unknown): CharacterIdInput => {
  const characterId =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).characterId
      : undefined;
  if (typeof characterId !== 'string' || !ID_PATTERN.test(characterId)) {
    throw new Error('The character id is invalid.');
  }
  return { characterId };
};

export const parseCreateLocalCharacterInput = (value: unknown): CreateLocalCharacterInput => {
  const name =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).name
      : undefined;
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 80) {
    throw new Error('The local character name is invalid.');
  }
  return { name: name.trim() };
};
