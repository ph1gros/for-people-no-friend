import { CHARACTER_EMOTIONS, type CharacterEmotion } from '../core/character/character-reply';
import type { CharacterPresentationState } from '../core/presentation/character-presentation';

export const DEFAULT_VTUBE_STUDIO_PORT = 8_001;
export const MIN_VTUBE_STUDIO_PORT = 1_024;
export const MAX_VTUBE_STUDIO_PORT = 65_535;

export interface VTubeStudioSettings {
  enabled: boolean;
  port: number;
  mouseTrackingEnabled: boolean;
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
  detail: string;
}

export interface VTubeStudioOperationResult {
  ok: boolean;
  message?: string;
}

export interface VTubeStudioInspectResult extends VTubeStudioOperationResult {
  inventory?: VTubeStudioInventory;
}

export interface SetVTubeStudioSettingsInput {
  settings: VTubeStudioSettings;
}

export interface VTubeStudioPresentationInput {
  state?: CharacterPresentationState;
  emotion?: CharacterEmotion;
  action?: string;
}

export type VTubeStudioExpressionPreviewInput =
  { active: true; expressionIndex: number } | { active: false };

export const DEFAULT_VTUBE_STUDIO_SETTINGS: VTubeStudioSettings = Object.freeze({
  enabled: false,
  port: DEFAULT_VTUBE_STUDIO_PORT,
  mouseTrackingEnabled: false,
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

export const parseVTubeStudioSettings = (value: unknown): VTubeStudioSettings => {
  const record = asRecord(value, 'VTube Studio settings');
  if (
    Object.keys(record).some(
      (key) => key !== 'enabled' && key !== 'port' && key !== 'mouseTrackingEnabled',
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
  return {
    enabled: record.enabled,
    port: record.port as number,
    mouseTrackingEnabled: record.mouseTrackingEnabled ?? false,
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
