import { validateCharacterProfile, type CharacterProfile } from '../conversation/character-profile';

export interface CharacterPackageManifest {
  version: 1;
  packageId: string;
  character: CharacterProfile;
  modelManifest?: string;
  assets: Array<{ path: string; sha256: string }>;
  attribution: Array<{ title: string; url: string; licenseNote: string }>;
  minimumAppVersion: string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const isSafePackagePath = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 240 &&
  !value.includes('\\') &&
  !value.startsWith('/') &&
  !value.split('/').includes('..') &&
  !/^[a-z][a-z\d+.-]*:/i.test(value);

export const validateCharacterPackageManifest = (value: unknown): CharacterPackageManifest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The character package manifest is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.packageId !== 'string' ||
    !ID_PATTERN.test(record.packageId) ||
    typeof record.minimumAppVersion !== 'string' ||
    !VERSION_PATTERN.test(record.minimumAppVersion) ||
    (record.modelManifest !== undefined && !isSafePackagePath(record.modelManifest)) ||
    !Array.isArray(record.assets) ||
    record.assets.length > 2_000 ||
    !Array.isArray(record.attribution) ||
    record.attribution.length > 50
  ) {
    throw new Error('The character package manifest is invalid.');
  }
  const assets = record.assets.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('The character package asset is invalid.');
    }
    const asset = value as Record<string, unknown>;
    if (
      !isSafePackagePath(asset.path) ||
      typeof asset.sha256 !== 'string' ||
      !SHA256_PATTERN.test(asset.sha256)
    ) {
      throw new Error('The character package asset is invalid.');
    }
    return { path: asset.path, sha256: asset.sha256 };
  });
  if (new Set(assets.map(({ path }) => path)).size !== assets.length) {
    throw new Error('The character package contains duplicate assets.');
  }
  const attribution = record.attribution.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('The character package attribution is invalid.');
    }
    const item = value as Record<string, unknown>;
    if (
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      item.title.length > 200 ||
      typeof item.url !== 'string' ||
      typeof item.licenseNote !== 'string' ||
      item.licenseNote.length > 1_000
    ) {
      throw new Error('The character package attribution is invalid.');
    }
    const url = new URL(item.url);
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('The character package attribution is invalid.');
    }
    return { title: item.title.trim(), url: url.toString(), licenseNote: item.licenseNote.trim() };
  });
  return {
    version: 1,
    packageId: record.packageId,
    character: validateCharacterProfile(record.character),
    ...(record.modelManifest ? { modelManifest: record.modelManifest as string } : {}),
    assets,
    attribution,
    minimumAppVersion: record.minimumAppVersion,
  };
};
