import { CHARACTER_EMOTIONS, type CharacterEmotion } from '../core/character/character-reply';
import type { CharacterPresentationState } from '../core/presentation/character-presentation';

export const MIN_VIEWEREX_PORT = 10_086;
export const MAX_VIEWEREX_PORT = 10_150;
export const MAX_VIEWEREX_MODEL_INDEX = 7;
export const MAX_VIEWEREX_PRESENTATION_TEXT_LENGTH = 32_768;

const ACTION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MOTION_PATTERN = /^[A-Za-z0-9_.-]{1,64}(?::[A-Za-z0-9_.-]{1,64})?$/;
const WORKSHOP_ITEM_PATTERN = /^\d{1,20}$/;
const PRESENTATION_STATES = new Set<CharacterPresentationState>(['idle', 'thinking', 'talking']);
const EMOTIONS = new Set<string>(CHARACTER_EMOTIONS);

export interface ViewerExSettings {
  enabled: boolean;
  port: number;
  modelIndex: number;
  workshopItemId: string;
  bubbleEnabled: boolean;
  bubbleDurationMs: number;
  stateMotions: Partial<Record<CharacterPresentationState, string>>;
  emotionExpressions: Partial<Record<CharacterEmotion, number>>;
  actionMotions: Record<string, string>;
}

export interface ViewerExPresentationInput {
  state?: CharacterPresentationState;
  emotion?: CharacterEmotion;
  action?: string;
  text?: string;
}

export type ViewerExConnectionState = 'disabled' | 'disconnected' | 'connecting' | 'connected';

export interface ViewerExStatus {
  settings: ViewerExSettings;
  connection: ViewerExConnectionState;
  detail: string;
}

export interface ViewerExOperationResult {
  ok: boolean;
  message?: string;
}

export interface SetViewerExSettingsInput {
  settings: ViewerExSettings;
}

export const DEFAULT_VIEWEREX_SETTINGS: ViewerExSettings = Object.freeze({
  enabled: false,
  port: MIN_VIEWEREX_PORT,
  modelIndex: 0,
  workshopItemId: '',
  bubbleEnabled: true,
  bubbleDurationMs: 6_000,
  stateMotions: Object.freeze({}),
  emotionExpressions: Object.freeze({}),
  actionMotions: Object.freeze({}),
});

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const parseInteger = (value: unknown, minimum: number, maximum: number, label: string): number => {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} is outside the allowed range.`);
  }
  return value as number;
};

export const parseViewerExSettings = (value: unknown): ViewerExSettings => {
  const record = asRecord(value, 'ViewerEX settings');
  if (typeof record.enabled !== 'boolean' || typeof record.bubbleEnabled !== 'boolean') {
    throw new Error('ViewerEX switches must be boolean values.');
  }

  const rawExpressions = asRecord(record.emotionExpressions, 'ViewerEX expression mappings');
  if (Object.keys(rawExpressions).length > CHARACTER_EMOTIONS.length) {
    throw new Error('Too many ViewerEX expression mappings.');
  }

  const rawStateMotions = asRecord(
    record.stateMotions ?? {},
    'ViewerEX presentation state mappings',
  );
  if (Object.keys(rawStateMotions).length > PRESENTATION_STATES.size) {
    throw new Error('Too many ViewerEX presentation state mappings.');
  }
  const stateMotions: Partial<Record<CharacterPresentationState, string>> = {};
  for (const [state, motion] of Object.entries(rawStateMotions)) {
    if (
      !PRESENTATION_STATES.has(state as CharacterPresentationState) ||
      typeof motion !== 'string' ||
      !MOTION_PATTERN.test(motion)
    ) {
      throw new Error('ViewerEX state mappings must use safe group or group:motion IDs.');
    }
    stateMotions[state as CharacterPresentationState] = motion;
  }
  const emotionExpressions: Partial<Record<CharacterEmotion, number>> = {};
  for (const [emotion, expressionId] of Object.entries(rawExpressions)) {
    if (!EMOTIONS.has(emotion)) throw new Error('Unknown ViewerEX emotion mapping.');
    emotionExpressions[emotion as CharacterEmotion] = parseInteger(
      expressionId,
      0,
      4_095,
      'ViewerEX expression ID',
    );
  }

  const rawMotions = asRecord(record.actionMotions, 'ViewerEX motion mappings');
  if (Object.keys(rawMotions).length > 64) throw new Error('Too many ViewerEX motion mappings.');
  const actionMotions: Record<string, string> = {};
  for (const [action, motion] of Object.entries(rawMotions)) {
    if (
      !ACTION_PATTERN.test(action) ||
      typeof motion !== 'string' ||
      !MOTION_PATTERN.test(motion)
    ) {
      throw new Error('ViewerEX motion mappings must use safe group or group:motion IDs.');
    }
    actionMotions[action] = motion;
  }

  return {
    enabled: record.enabled,
    port: parseInteger(record.port, MIN_VIEWEREX_PORT, MAX_VIEWEREX_PORT, 'ViewerEX port'),
    modelIndex: parseInteger(
      record.modelIndex,
      0,
      MAX_VIEWEREX_MODEL_INDEX,
      'ViewerEX model index',
    ),
    workshopItemId:
      record.workshopItemId === undefined || record.workshopItemId === ''
        ? ''
        : typeof record.workshopItemId === 'string' &&
            WORKSHOP_ITEM_PATTERN.test(record.workshopItemId)
          ? record.workshopItemId
          : (() => {
              throw new Error('Invalid ViewerEX Workshop item ID.');
            })(),
    bubbleEnabled: record.bubbleEnabled,
    bubbleDurationMs: parseInteger(
      record.bubbleDurationMs,
      1_000,
      30_000,
      'ViewerEX bubble duration',
    ),
    stateMotions,
    emotionExpressions,
    actionMotions,
  };
};

export const parseSetViewerExSettingsInput = (value: unknown): { settings: ViewerExSettings } => {
  const record = asRecord(value, 'Set ViewerEX settings input');
  return { settings: parseViewerExSettings(record.settings) };
};

export const parseViewerExPresentationInput = (value: unknown): ViewerExPresentationInput => {
  const record = asRecord(value, 'ViewerEX presentation input');
  const result: ViewerExPresentationInput = {};
  if (record.state !== undefined) {
    if (
      typeof record.state !== 'string' ||
      !PRESENTATION_STATES.has(record.state as CharacterPresentationState)
    ) {
      throw new Error('Unknown ViewerEX presentation state.');
    }
    result.state = record.state as CharacterPresentationState;
  }
  if (record.emotion !== undefined) {
    if (typeof record.emotion !== 'string' || !EMOTIONS.has(record.emotion)) {
      throw new Error('Unknown ViewerEX emotion.');
    }
    result.emotion = record.emotion as CharacterEmotion;
  }
  if (record.action !== undefined) {
    if (typeof record.action !== 'string' || !ACTION_PATTERN.test(record.action)) {
      throw new Error('Invalid ViewerEX action.');
    }
    result.action = record.action;
  }
  if (record.text !== undefined) {
    if (
      typeof record.text !== 'string' ||
      record.text.length === 0 ||
      record.text.length > MAX_VIEWEREX_PRESENTATION_TEXT_LENGTH
    ) {
      throw new Error('Invalid ViewerEX presentation text.');
    }
    result.text = record.text;
  }
  if (Object.keys(result).length === 0) throw new Error('ViewerEX presentation input is empty.');
  return result;
};
