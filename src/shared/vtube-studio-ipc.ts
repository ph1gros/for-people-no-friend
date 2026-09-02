import { CHARACTER_EMOTIONS, type CharacterEmotion } from '../core/character/character-reply';
import type { CharacterPresentationState } from '../core/presentation/character-presentation';

export const DEFAULT_VTUBE_STUDIO_PORT = 8_001;
export const MIN_VTUBE_STUDIO_PORT = 1_024;
export const MAX_VTUBE_STUDIO_PORT = 65_535;

export interface VTubeStudioSettings {
  enabled: boolean;
  port: number;
  mouseTrackingEnabled: boolean;
  emotionExpressions: Partial<Record<CharacterEmotion, string>>;
  modelMappings?: Record<string, VTubeStudioModelMapping>;
}

export interface VTubeStudioModelMapping {
  modelName: string;
  emotionExpressions: Partial<Record<CharacterEmotion, string>>;
  actionHotkeys: Record<string, string>;
}

export interface VTubeStudioModelMappingSuggestion {
  emotionExpressions: Partial<Record<CharacterEmotion, string>>;
  actionHotkeys: Record<string, string>;
}

export type VTubeStudioConnectionState =
  'disabled' | 'disconnected' | 'connecting' | 'awaiting-authorization' | 'connected';

export interface VTubeStudioModelSummary {
  loaded: boolean;
  name: string;
  id: string;
  vtsModelName: string;
  live2DModelName: string;
  parameterCount: number;
  artmeshCount: number;
  textureCount: number;
  textureResolution: number;
}

export interface VTubeStudioHotkeySummary {
  name: string;
  type: string;
  file: string;
  hotkeyId: string;
  onScreenButtonId: number;
}

export interface VTubeStudioExpressionSummary {
  name: string;
  file: string;
  active: boolean;
  deactivateWhenKeyIsLetGo: boolean;
  parameters: Array<{ name: string; value: number }>;
  hotkeyNames: string[];
}

export interface VTubeStudioParameterSummary {
  name: string;
  value: number;
  minimum: number;
  maximum: number;
  defaultValue: number;
}

export interface VTubeStudioInventory {
  model: VTubeStudioModelSummary;
  hotkeys: VTubeStudioHotkeySummary[];
  expressions: VTubeStudioExpressionSummary[];
  parameters: VTubeStudioParameterSummary[];
}

export interface VTubeStudioStatus {
  settings: VTubeStudioSettings;
  connection: VTubeStudioConnectionState;
  authorized: boolean;
  bundledModelAvailable: boolean;
  detail: string;
}

export interface VTubeStudioOperationResult {
  ok: boolean;
  message?: string;
}

export type VTubeStudioConnectionReason =
  'authorized' | 'api-disabled' | 'unavailable' | 'authorization-denied';

export interface VTubeStudioAuthorizationResult extends VTubeStudioOperationResult {
  reason: VTubeStudioConnectionReason;
}

export interface VTubeStudioInspectResult extends VTubeStudioOperationResult {
  reason?: VTubeStudioConnectionReason;
  inventory?: VTubeStudioInventory;
  mapping?: {
    modelId: string;
    modelName: string;
    confirmed?: VTubeStudioModelMapping;
    suggestions: VTubeStudioModelMappingSuggestion;
  };
}

export interface SetVTubeStudioSettingsInput {
  settings: VTubeStudioSettings;
}

export interface VTubeStudioPresentationInput {
  state?: CharacterPresentationState;
  emotion?: CharacterEmotion;
  action?: string;
}

export type VTubeStudioPresentationReason =
  | 'presented'
  | 'disabled'
  | 'not-authorized'
  | 'model-not-loaded'
  | 'mapping-missing'
  | 'connection-failed'
  | 'invalid-intent';

export interface VTubeStudioPresentationResult extends VTubeStudioOperationResult {
  reason: VTubeStudioPresentationReason;
}

export type VTubeStudioExpressionPreviewInput =
  { active: true; expressionIndex: number } | { active: false };

export const DEFAULT_VTUBE_STUDIO_SETTINGS: VTubeStudioSettings = Object.freeze({
  enabled: false,
  port: DEFAULT_VTUBE_STUDIO_PORT,
  mouseTrackingEnabled: false,
  emotionExpressions: Object.freeze({}),
  modelMappings: Object.freeze({}),
});

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const PRESENTATION_STATES = new Set<CharacterPresentationState>(['idle', 'thinking', 'talking']);
const EMOTIONS = new Set<string>(CHARACTER_EMOTIONS);
const ACTION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const containsControlCharacters = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });

const parseEmotionExpressions = (value: unknown): Partial<Record<CharacterEmotion, string>> => {
  const rawEmotionExpressions = asRecord(value ?? {}, 'VTube Studio emotion expression mappings');
  if (Object.keys(rawEmotionExpressions).length > CHARACTER_EMOTIONS.length) {
    throw new Error('Too many VTube Studio emotion expression mappings.');
  }
  const emotionExpressions: Partial<Record<CharacterEmotion, string>> = {};
  for (const [emotion, expressionFile] of Object.entries(rawEmotionExpressions)) {
    if (
      !EMOTIONS.has(emotion) ||
      typeof expressionFile !== 'string' ||
      expressionFile.length > 256 ||
      !expressionFile.toLowerCase().endsWith('.exp3.json') ||
      expressionFile.includes('/') ||
      expressionFile.includes('\\') ||
      containsControlCharacters(expressionFile)
    ) {
      throw new Error('The VTube Studio emotion expression mapping is invalid.');
    }
    emotionExpressions[emotion as CharacterEmotion] = expressionFile;
  }
  return emotionExpressions;
};

const parseModelMappings = (value: unknown): Record<string, VTubeStudioModelMapping> => {
  const rawMappings = asRecord(value ?? {}, 'VTube Studio model mappings');
  if (Object.keys(rawMappings).length > 32) {
    throw new Error('Too many VTube Studio model mappings.');
  }
  const mappings: Record<string, VTubeStudioModelMapping> = {};
  for (const [modelId, rawMapping] of Object.entries(rawMappings)) {
    if (
      modelId.length < 1 ||
      modelId.length > 128 ||
      containsControlCharacters(modelId) ||
      modelId.includes('/') ||
      modelId.includes('\\')
    ) {
      throw new Error('The VTube Studio model ID is invalid.');
    }
    const mapping = asRecord(rawMapping, 'VTube Studio model mapping');
    if (
      Object.keys(mapping).some(
        (key) => !['modelName', 'emotionExpressions', 'actionHotkeys'].includes(key),
      ) ||
      typeof mapping.modelName !== 'string' ||
      mapping.modelName.length > 256 ||
      containsControlCharacters(mapping.modelName)
    ) {
      throw new Error('The VTube Studio model mapping is invalid.');
    }
    const rawActionHotkeys = asRecord(mapping.actionHotkeys ?? {}, 'VTube Studio action mappings');
    if (Object.keys(rawActionHotkeys).length > 32) {
      throw new Error('Too many VTube Studio action mappings.');
    }
    const actionHotkeys: Record<string, string> = {};
    for (const [action, hotkeyId] of Object.entries(rawActionHotkeys)) {
      if (
        !ACTION_PATTERN.test(action) ||
        typeof hotkeyId !== 'string' ||
        hotkeyId.length < 1 ||
        hotkeyId.length > 256 ||
        containsControlCharacters(hotkeyId)
      ) {
        throw new Error('The VTube Studio action mapping is invalid.');
      }
      actionHotkeys[action] = hotkeyId;
    }
    mappings[modelId] = {
      modelName: mapping.modelName,
      emotionExpressions: parseEmotionExpressions(mapping.emotionExpressions),
      actionHotkeys,
    };
  }
  return mappings;
};

export const parseVTubeStudioSettings = (value: unknown): VTubeStudioSettings => {
  const record = asRecord(value, 'VTube Studio settings');
  if (
    Object.keys(record).some(
      (key) =>
        key !== 'enabled' &&
        key !== 'port' &&
        key !== 'mouseTrackingEnabled' &&
        key !== 'emotionExpressions' &&
        key !== 'modelMappings',
    )
  ) {
    throw new Error('The VTube Studio settings contain an unknown field.');
  }
  if (typeof record.enabled !== 'boolean') {
    throw new Error('The VTube Studio enabled switch must be boolean.');
  }
  if (
    !Number.isInteger(record.port) ||
    (record.port as number) < MIN_VTUBE_STUDIO_PORT ||
    (record.port as number) > MAX_VTUBE_STUDIO_PORT
  ) {
    throw new Error('The VTube Studio port is outside the allowed range.');
  }
  if (
    record.mouseTrackingEnabled !== undefined &&
    typeof record.mouseTrackingEnabled !== 'boolean'
  ) {
    throw new Error('The VTube Studio mouse tracking switch must be boolean.');
  }
  const emotionExpressions = parseEmotionExpressions(record.emotionExpressions);
  return {
    enabled: record.enabled,
    port: record.port as number,
    mouseTrackingEnabled: record.mouseTrackingEnabled ?? false,
    emotionExpressions,
    modelMappings: parseModelMappings(record.modelMappings),
  };
};

export const parseSetVTubeStudioSettingsInput = (value: unknown): SetVTubeStudioSettingsInput => {
  const record = asRecord(value, 'Set VTube Studio settings input');
  return { settings: parseVTubeStudioSettings(record.settings) };
};

export const parseVTubeStudioPresentationInput = (value: unknown): VTubeStudioPresentationInput => {
  const record = asRecord(value, 'VTube Studio presentation input');
  if (Object.keys(record).some((key) => !['state', 'emotion', 'action'].includes(key))) {
    throw new Error('The VTube Studio presentation input contains an unknown field.');
  }
  const result: VTubeStudioPresentationInput = {};
  if (record.state !== undefined) {
    if (
      typeof record.state !== 'string' ||
      !PRESENTATION_STATES.has(record.state as CharacterPresentationState)
    ) {
      throw new Error('Unknown VTube Studio presentation state.');
    }
    result.state = record.state as CharacterPresentationState;
  }
  if (record.emotion !== undefined) {
    if (typeof record.emotion !== 'string' || !EMOTIONS.has(record.emotion)) {
      throw new Error('Unknown VTube Studio emotion.');
    }
    result.emotion = record.emotion as CharacterEmotion;
  }
  if (record.action !== undefined) {
    if (typeof record.action !== 'string' || !ACTION_PATTERN.test(record.action)) {
      throw new Error('Invalid VTube Studio action.');
    }
    result.action = record.action;
  }
  if (Object.keys(result).length === 0) {
    throw new Error('VTube Studio presentation input is empty.');
  }
  return result;
};

export const parseVTubeStudioExpressionPreviewInput = (
  value: unknown,
): VTubeStudioExpressionPreviewInput => {
  const record = asRecord(value, 'VTube Studio expression preview input');
  if (Object.keys(record).some((key) => !['active', 'expressionIndex'].includes(key))) {
    throw new Error('The VTube Studio expression preview input contains an unknown field.');
  }
  if (record.active === false && record.expressionIndex === undefined) return { active: false };
  if (
    record.active !== true ||
    !Number.isInteger(record.expressionIndex) ||
    (record.expressionIndex as number) < 0 ||
    (record.expressionIndex as number) >= 256
  ) {
    throw new Error('The VTube Studio expression preview index is invalid.');
  }
  return { active: true, expressionIndex: record.expressionIndex as number };
};
