import { CHARACTER_EMOTIONS, type CharacterEmotion } from '../../core/character/character-reply';
import type { CharacterState } from '../live2d/contracts';

const CHARACTER_REGISTRY_URL = './characters/registry.json';
const CHARACTER_STATES = ['idle', 'thinking', 'talking'] as const;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SHA256_PATTERN = /^[a-f\d]{64}$/;
const TAG_PATTERN = /^[a-z\d][a-z\d:_-]{0,63}$/;

export interface AnimatedWebpAsset {
  id: string;
  file: string;
  width: number;
  height: number;
  frameCount: number;
  durationMs: number;
  sha256: string;
  tags: string[];
}

export interface AnimatedWebpCharacterManifest {
  schemaVersion: 1;
  id: string;
  templateVersion: string;
  name: string;
  renderer: 'animated-webp';
  canvas: { width: number; height: number };
  presentation: { scale: number };
  attribution: {
    creator: string;
    creatorUrl: string;
    sourceUrl: string;
    permission: string;
  };
  assets: AnimatedWebpAsset[];
  channels: {
    states: Record<CharacterState, string>;
    emotions: Record<CharacterEmotion, string>;
    actions: Record<string, string>;
  };
  manifestUrl: string;
}

export class CharacterManifestError extends Error {
  public constructor(
    message: string,
    public readonly kind: 'missing' | 'invalid' | 'unavailable',
  ) {
    super(message);
    this.name = 'CharacterManifestError';
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isSafeLocalPath = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 240 &&
  !value.includes('\\') &&
  !value.split('/').includes('..') &&
  !value.startsWith('/') &&
  !/^[a-z][a-z\d+.-]*:/i.test(value);

const isSafeHttpsUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 2_000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
};

const isDimension = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 128 && (value as number) <= 1_024;

const parseStringMap = <K extends string>(
  value: unknown,
  keys?: readonly K[],
): Record<K, string> | undefined => {
  if (!isObject(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      (keys && !keys.includes(key as K)) ||
      (!keys && !IDENTIFIER_PATTERN.test(key)) ||
      typeof item !== 'string' ||
      item.length === 0 ||
      item.length > 120
    ) {
      return undefined;
    }
    result[key] = item;
  }
  if (keys && !keys.every((key) => key in result)) return undefined;
  return result as Record<K, string>;
};

export const parseAnimatedWebpCharacterManifest = (
  value: unknown,
  manifestUrl = 'https://local.invalid/characters/character.json',
): AnimatedWebpCharacterManifest | undefined => {
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    !IDENTIFIER_PATTERN.test(typeof value.id === 'string' ? value.id : '') ||
    typeof value.templateVersion !== 'string' ||
    value.templateVersion.length === 0 ||
    value.templateVersion.length > 32 ||
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    value.name.length > 80 ||
    value.renderer !== 'animated-webp' ||
    !isObject(value.canvas) ||
    !isDimension(value.canvas.width) ||
    !isDimension(value.canvas.height) ||
    !isObject(value.attribution) ||
    typeof value.attribution.creator !== 'string' ||
    value.attribution.creator.trim().length === 0 ||
    value.attribution.creator.length > 200 ||
    !isSafeHttpsUrl(value.attribution.creatorUrl) ||
    !isSafeHttpsUrl(value.attribution.sourceUrl) ||
    typeof value.attribution.permission !== 'string' ||
    value.attribution.permission.trim().length === 0 ||
    value.attribution.permission.length > 500 ||
    !Array.isArray(value.assets) ||
    value.assets.length === 0 ||
    value.assets.length > 128 ||
    !isObject(value.channels)
  ) {
    return undefined;
  }

  const assets: AnimatedWebpAsset[] = [];
  const assetIds = new Set<string>();
  for (const item of value.assets) {
    if (
      !isObject(item) ||
      typeof item.id !== 'string' ||
      item.id.length === 0 ||
      item.id.length > 120 ||
      assetIds.has(item.id) ||
      !isSafeLocalPath(item.file) ||
      !item.file.toLowerCase().endsWith('.webp') ||
      !isDimension(item.width) ||
      !isDimension(item.height) ||
      item.width !== item.height ||
      !Number.isInteger(item.frameCount) ||
      (item.frameCount as number) < 2 ||
      (item.frameCount as number) > 1_000 ||
      !Number.isInteger(item.durationMs) ||
      (item.durationMs as number) < 100 ||
      (item.durationMs as number) > 60_000 ||
      typeof item.sha256 !== 'string' ||
      !SHA256_PATTERN.test(item.sha256) ||
      !Array.isArray(item.tags) ||
      item.tags.length === 0 ||
      item.tags.length > 24 ||
      !item.tags.every((tag) => typeof tag === 'string' && TAG_PATTERN.test(tag))
    ) {
      return undefined;
    }
    assetIds.add(item.id);
    assets.push({
      id: item.id,
      file: item.file,
      width: item.width,
      height: item.height,
      frameCount: item.frameCount as number,
      durationMs: item.durationMs as number,
      sha256: item.sha256,
      tags: [...new Set(item.tags)],
    });
  }

  const states = parseStringMap<CharacterState>(value.channels.states, CHARACTER_STATES);
  const emotions = parseStringMap<CharacterEmotion>(value.channels.emotions, CHARACTER_EMOTIONS);
  const actions = parseStringMap<string>(value.channels.actions);
  if (!states || !emotions || !actions) return undefined;
  const presentationScale = isObject(value.presentation) ? value.presentation.scale : 1;
  if (
    typeof presentationScale !== 'number' ||
    !Number.isFinite(presentationScale) ||
    presentationScale < 0.4 ||
    presentationScale > 1
  ) {
    return undefined;
  }
  if (
    !Object.values(states).every((id) => assetIds.has(id)) ||
    !Object.values(emotions).every((id) => assetIds.has(id)) ||
    !Object.values(actions).every((id) => assetIds.has(id))
  ) {
    return undefined;
  }

  return {
    schemaVersion: 1,
    id: value.id as string,
    templateVersion: value.templateVersion,
    name: value.name.trim(),
    renderer: 'animated-webp',
    canvas: { width: value.canvas.width, height: value.canvas.height },
    presentation: { scale: presentationScale },
    attribution: {
      creator: value.attribution.creator.trim(),
      creatorUrl: value.attribution.creatorUrl,
      sourceUrl: value.attribution.sourceUrl,
      permission: value.attribution.permission.trim(),
    },
    assets,
    channels: { states, emotions, actions },
    manifestUrl,
  };
};

const readJsonResponse = async (response: Response, label: string): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new CharacterManifestError(`${label}不是有效的 JSON。`, 'invalid');
  }
};

export const loadAnimatedWebpCharacter = async (
  appearanceId: string,
  fetcher: typeof fetch = fetch,
): Promise<AnimatedWebpCharacterManifest | undefined> => {
  if (!IDENTIFIER_PATTERN.test(appearanceId)) return undefined;
  let registryResponse: Response;
  try {
    registryResponse = await fetcher(CHARACTER_REGISTRY_URL, { cache: 'no-store' });
  } catch {
    throw new CharacterManifestError('无法读取本地角色注册表。', 'unavailable');
  }
  if (registryResponse.status === 404) return undefined;
  if (!registryResponse.ok) {
    throw new CharacterManifestError(
      `角色注册表读取失败（HTTP ${registryResponse.status}）。`,
      'unavailable',
    );
  }
  const registry = await readJsonResponse(registryResponse, 'registry.json ');
  if (
    !isObject(registry) ||
    registry.version !== 1 ||
    !Array.isArray(registry.characters) ||
    registry.characters.length > 32
  ) {
    throw new CharacterManifestError('registry.json 格式无效。', 'invalid');
  }
  const entries = registry.characters.filter(
    (entry): entry is { appearanceId: string; manifest: string } =>
      isObject(entry) &&
      typeof entry.appearanceId === 'string' &&
      IDENTIFIER_PATTERN.test(entry.appearanceId) &&
      isSafeLocalPath(entry.manifest) &&
      entry.manifest.toLowerCase().endsWith('.json'),
  );
  if (entries.length !== registry.characters.length) {
    throw new CharacterManifestError('registry.json 包含无效或不安全的角色条目。', 'invalid');
  }
  const selected = entries.find((entry) => entry.appearanceId === appearanceId);
  if (!selected) return undefined;

  const manifestUrl = new URL(selected.manifest, new URL('./characters/', window.location.href))
    .href;
  let response: Response;
  try {
    response = await fetcher(manifestUrl, { cache: 'no-store' });
  } catch {
    throw new CharacterManifestError('无法读取本地 WebP 角色清单。', 'unavailable');
  }
  if (!response.ok) {
    throw new CharacterManifestError(
      `WebP 角色清单读取失败（HTTP ${response.status}）。`,
      response.status === 404 ? 'missing' : 'unavailable',
    );
  }
  const manifest = parseAnimatedWebpCharacterManifest(
    await readJsonResponse(response, 'character.json '),
    manifestUrl,
  );
  if (!manifest) {
    throw new CharacterManifestError('character.json 格式无效或包含不安全资源。', 'invalid');
  }
  return manifest;
};

export const resolveAnimatedWebpAssetUrl = (
  manifest: AnimatedWebpCharacterManifest,
  file: string,
): string => new URL(file, manifest.manifestUrl).href;
