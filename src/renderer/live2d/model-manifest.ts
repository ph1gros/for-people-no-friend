import type {
  CharacterEmotion,
  CharacterState,
  Live2DControlMap,
  MotionReference,
} from './contracts';

export const LOCAL_MODEL_ROOT = './models/local/';
export const MODEL_MANIFEST_URL = `${LOCAL_MODEL_ROOT}model.json`;

export interface LocalModelManifest {
  version: 1;
  name: string;
  core: string;
  model: string;
  parameters?: Record<string, number>;
  controls: Live2DControlMap;
}

export class ModelManifestError extends Error {
  public constructor(
    message: string,
    public readonly kind: 'missing' | 'invalid' | 'unavailable',
  ) {
    super(message);
    this.name = 'ModelManifestError';
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isSafeLocalPath = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  !value.includes('\\') &&
  !value.split('/').includes('..') &&
  !value.startsWith('/') &&
  !/^[a-z][a-z\d+.-]*:/i.test(value);

const parseMotion = (value: unknown): MotionReference | undefined => {
  if (!isObject(value) || typeof value.group !== 'string' || value.group.length === 0) {
    return undefined;
  }
  if (
    value.index !== undefined &&
    (!Number.isInteger(value.index) || (value.index as number) < 0)
  ) {
    return undefined;
  }
  return {
    group: value.group,
    ...(value.index === undefined ? {} : { index: value.index as number }),
  };
};

const parseMotionMap = <K extends string>(
  value: unknown,
  allowedKeys?: readonly K[],
): Partial<Record<K, MotionReference>> | undefined => {
  if (!isObject(value)) {
    return undefined;
  }
  const result: Partial<Record<K, MotionReference>> = {};
  for (const [key, item] of Object.entries(value)) {
    if (allowedKeys && !allowedKeys.includes(key as K)) {
      return undefined;
    }
    const motion = parseMotion(item);
    if (!motion) {
      return undefined;
    }
    result[key as K] = motion;
  }
  return result;
};

const parseStringMap = <K extends string>(
  value: unknown,
  allowedKeys: readonly K[],
): Partial<Record<K, string>> | undefined => {
  if (!isObject(value)) {
    return undefined;
  }
  const result: Partial<Record<K, string>> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!allowedKeys.includes(key as K) || typeof item !== 'string' || item.length === 0) {
      return undefined;
    }
    result[key as K] = item;
  }
  return result;
};

const parseParameterMap = (value: unknown): Record<string, number> | undefined => {
  if (!isObject(value)) {
    return undefined;
  }
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.length === 0 || typeof item !== 'number' || !Number.isFinite(item)) {
      return undefined;
    }
    result[key] = item;
  }
  return result;
};

const STATES = ['idle', 'thinking', 'talking'] as const satisfies readonly CharacterState[];
const EMOTIONS = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprised',
  'shy',
  'playful',
] as const satisfies readonly CharacterEmotion[];

export const parseLocalModelManifest = (value: unknown): LocalModelManifest | undefined => {
  if (
    !isObject(value) ||
    value.version !== 1 ||
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    !isSafeLocalPath(value.core) ||
    !isSafeLocalPath(value.model) ||
    !value.core.toLowerCase().endsWith('.js') ||
    !value.model.toLowerCase().endsWith('.model3.json') ||
    !isObject(value.controls)
  ) {
    return undefined;
  }

  const states = parseMotionMap<CharacterState>(value.controls.states, STATES);
  const actions = parseMotionMap<string>(value.controls.actions);
  const emotions = parseStringMap<CharacterEmotion>(value.controls.emotions, EMOTIONS);
  const parameters =
    value.parameters === undefined ? undefined : parseParameterMap(value.parameters);
  if (!states || !actions || !emotions || (value.parameters !== undefined && !parameters)) {
    return undefined;
  }

  return {
    version: 1,
    name: value.name,
    core: value.core,
    model: value.model,
    ...(parameters ? { parameters } : {}),
    controls: { states, actions: actions as Record<string, MotionReference>, emotions },
  };
};

export const resolveLocalModelUrl = (relativePath: string): string =>
  new URL(relativePath, new URL(LOCAL_MODEL_ROOT, window.location.href)).href;

export const loadLocalModelManifest = async (
  fetcher: typeof fetch = fetch,
): Promise<LocalModelManifest> => {
  let response: Response;
  try {
    response = await fetcher(MODEL_MANIFEST_URL, { cache: 'no-store' });
  } catch {
    throw new ModelManifestError('无法读取本地 Live2D 模型配置。', 'unavailable');
  }

  if (response.status === 404) {
    throw new ModelManifestError('尚未放置 Live2D 模型。', 'missing');
  }
  if (!response.ok) {
    throw new ModelManifestError(`模型配置读取失败（HTTP ${response.status}）。`, 'unavailable');
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ModelManifestError('model.json 不是有效的 JSON。', 'invalid');
  }
  const manifest = parseLocalModelManifest(value);
  if (!manifest) {
    throw new ModelManifestError('model.json 格式无效或包含不安全路径。', 'invalid');
  }
  return manifest;
};
