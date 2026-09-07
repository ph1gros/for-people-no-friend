import {
  DEFAULT_SETUP_SELECTIONS,
  SETUP_CHARACTER_SOURCES,
  SETUP_MODES,
  SETUP_STEP_IDS,
  SETUP_VOICES,
  type SetupVoice,
  type SetupCharacterSource,
  type SetupMode,
  type SetupNavigationState,
  type SetupSelections,
  type SetupStepId,
} from '../core/setup/setup-flow';

import type {
  CharacterPackageFileResult,
  ConfirmCharacterPackageImportInput,
} from './character-package-ipc';
import type { Live2DModelImportResult } from './live2d-model-ipc';
import {
  parseProviderId,
  type ConfigurableProviderId,
  type ModelOperationResult,
  type TestProviderConnectionInput,
  type TestProviderConnectionResult,
} from './model-ipc';

export type { SetupCharacterSource, SetupMode, SetupSelections, SetupStepId };
export { DEFAULT_SETUP_SELECTIONS, SETUP_CHARACTER_SOURCES, SETUP_MODES, SETUP_STEP_IDS };

export const SETUP_STATE_VERSION = 2;

export const SETUP_COMPLETION_SOURCES = ['wizard', 'existing-installation'] as const;

export type SetupCompletionSource = (typeof SETUP_COMPLETION_SOURCES)[number];

/**
 * Persisted first-run marker. Completion is stored explicitly instead of being inferred from
 * unrelated settings so that later setup revisions can migrate without resetting current users.
 */
export interface SetupState {
  version: number;
  completed: boolean;
  completedAt?: string;
  completedBy?: SetupCompletionSource;
  progress?: SetupProgress;
}

export interface SetupProgress {
  stepId: SetupStepId;
  selections: SetupSelections;
  rerun: boolean;
}

export const DEFAULT_SETUP_STATE: SetupState = Object.freeze({
  version: SETUP_STATE_VERSION,
  completed: false,
});

export interface SetupViewState extends SetupNavigationState {
  stateVersion: number;
  /** True when the wizard runs again on an installation that already has usable configuration. */
  rerun: boolean;
  appVersion: string;
}

export interface AdvanceSetupInput {
  selections: SetupSelections;
}

export interface CompleteSetupInput {
  selections: SetupSelections;
}

export interface SetupCompletionResult {
  completed: boolean;
  launchApp: boolean;
}

export interface SetupProviderOption {
  id: ConfigurableProviderId;
  displayName: string;
  /** Only the OpenAI-compatible provider exposes an editable endpoint. */
  requiresBaseUrl: boolean;
}

/**
 * What the wizard may show about credentials: which providers exist, the current endpoint and
 * model, and whether a key is already stored. The key itself never leaves the main process.
 */
export interface SetupProviderStatus {
  options: SetupProviderOption[];
  providerId: ConfigurableProviderId;
  baseUrl: string;
  modelId: string;
  configuredProviders: ConfigurableProviderId[];
  hasSecret: boolean;
}

export interface ApplySetupProviderInput {
  providerId: ConfigurableProviderId;
  baseUrl?: string;
  apiKey?: string;
  modelId: string;
}

export interface SetupCharacterStatus {
  source: SetupCharacterSource;
  activeCharacterName: string;
  importedCharacterCount: number;
  hasLive2DModel: boolean;
}

/**
 * The wizard sends only which voice to preview. Text, endpoint and voice id are all resolved in
 * Main from the fixed managed-voice table.
 */
export interface PreviewSetupVoiceInput {
  voice: SetupVoice;
}

export type SetupVoicePreviewReason =
  'played' | 'unsupported' | 'not-installed' | 'unavailable' | 'cancelled' | 'failed';

export interface SetupVoicePreviewResult {
  ok: boolean;
  reason: SetupVoicePreviewReason;
  /** Present only on success. Raw audio bytes; the wizard plays them and keeps nothing. */
  audio?: Uint8Array;
  mimeType?: string;
  /** The fixed sentence that was spoken, so the wizard can show it next to the button. */
  text?: string;
  message?: string;
}

export interface DeskpetSetupApi {
  getSetupResources(): Promise<import('./setup-resources').SetupResourceStatus>;
  controlSetupResources(
    input: import('./setup-resources').SetupResourceControl,
  ): Promise<SetupViewState>;
  getSetupState(): Promise<SetupViewState>;
  advanceSetup(input: AdvanceSetupInput): Promise<SetupViewState>;
  goBackInSetup(): Promise<SetupViewState>;
  cancelSetup(): Promise<boolean>;
  completeSetup(input: CompleteSetupInput): Promise<SetupCompletionResult>;
  getSetupProviderStatus(): Promise<SetupProviderStatus>;
  applySetupProvider(input: ApplySetupProviderInput): Promise<ModelOperationResult>;
  testSetupProvider(input: TestProviderConnectionInput): Promise<TestProviderConnectionResult>;
  cancelSetupProviderTest(input: { requestId: string }): Promise<boolean>;
  getSetupCharacterStatus(): Promise<SetupCharacterStatus>;
  previewSetupCharacterPackage(): Promise<CharacterPackageFileResult>;
  confirmSetupCharacterPackage(
    input: ConfirmCharacterPackageImportInput,
  ): Promise<CharacterPackageFileResult>;
  importSetupLive2DModel(): Promise<Live2DModelImportResult>;
  previewSetupVoice(input: PreviewSetupVoiceInput): Promise<SetupVoicePreviewResult>;
  stopSetupVoicePreview(): Promise<void>;
}

const SETUP_VOICE_SET = new Set<string>(SETUP_VOICES);
const SETUP_MODE_SET = new Set<string>(SETUP_MODES);

export const parsePreviewSetupVoiceInput = (value: unknown): PreviewSetupVoiceInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('试听请求无效。');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'voice') || typeof record.voice !== 'string')
    throw new Error('试听请求无效。');
  if (!SETUP_VOICE_SET.has(record.voice)) throw new Error('试听请求无效。');
  return { voice: record.voice as SetupVoice };
};
const SETUP_CHARACTER_SOURCE_SET = new Set<string>(SETUP_CHARACTER_SOURCES);
const MAX_TIMESTAMP_LENGTH = 40;
const MAX_BASE_URL_LENGTH = 2_048;
const MAX_MODEL_ID_LENGTH = 256;
const MAX_API_KEY_LENGTH = 32_768;

export const parseSetupSelections = (value: unknown): SetupSelections => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The setup selections are invalid.');
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.mode !== 'string' ||
    !SETUP_MODE_SET.has(candidate.mode) ||
    typeof candidate.characterSource !== 'string' ||
    !SETUP_CHARACTER_SOURCE_SET.has(candidate.characterSource) ||
    typeof candidate.launchAfterFinish !== 'boolean' ||
    (candidate.voice !== undefined && !SETUP_VOICES.includes(candidate.voice as SetupVoice)) ||
    (candidate.speechInput !== undefined && typeof candidate.speechInput !== 'boolean')
  ) {
    throw new Error('The setup selections are invalid.');
  }
  return {
    mode: candidate.mode as SetupMode,
    characterSource: candidate.characterSource as SetupCharacterSource,
    launchAfterFinish: candidate.launchAfterFinish,
    voice: (candidate.voice as SetupVoice | undefined) ?? 'none',
    speechInput: (candidate.speechInput as boolean | undefined) ?? false,
  };
};

const parseSelectionsEnvelope = (
  value: unknown,
  message: string,
): { selections: SetupSelections } => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('selections' in value)) {
    throw new Error(message);
  }
  return { selections: parseSetupSelections((value as Record<string, unknown>).selections) };
};

export const parseAdvanceSetupInput = (value: unknown): AdvanceSetupInput =>
  parseSelectionsEnvelope(value, 'The setup navigation input is invalid.');

export const parseCompleteSetupInput = (value: unknown): CompleteSetupInput =>
  parseSelectionsEnvelope(value, 'The setup completion input is invalid.');

/**
 * Validates the credential form. The API key is optional so that a returning page can keep an
 * already stored key, but a masked placeholder is never accepted as a new key.
 */
export const parseApplySetupProviderInput = (value: unknown): ApplySetupProviderInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The provider setup input is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  const providerId = parseProviderId(candidate.providerId);
  const modelId = candidate.modelId;
  if (
    typeof modelId !== 'string' ||
    modelId.trim().length === 0 ||
    modelId.length > MAX_MODEL_ID_LENGTH
  ) {
    throw new Error('The conversation model is invalid.');
  }
  const baseUrl = candidate.baseUrl;
  if (baseUrl !== undefined) {
    if (
      typeof baseUrl !== 'string' ||
      baseUrl.trim().length === 0 ||
      baseUrl.length > MAX_BASE_URL_LENGTH
    ) {
      throw new Error('The OpenAI-compatible base URL is invalid.');
    }
  }
  const apiKey = candidate.apiKey;
  if (apiKey !== undefined) {
    if (
      typeof apiKey !== 'string' ||
      apiKey.trim().length === 0 ||
      apiKey.length > MAX_API_KEY_LENGTH ||
      /^\*+$/.test(apiKey.trim())
    ) {
      throw new Error('A non-empty, unmasked API key is required.');
    }
  }
  return {
    providerId,
    modelId: modelId.trim(),
    ...(typeof baseUrl === 'string' ? { baseUrl: baseUrl.trim() } : {}),
    ...(typeof apiKey === 'string' ? { apiKey } : {}),
  };
};

export const parseSetupState = (value: unknown): SetupState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The setup state is invalid.');
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.version !== 'number' ||
    !Number.isInteger(candidate.version) ||
    candidate.version < 1 ||
    candidate.version > SETUP_STATE_VERSION ||
    typeof candidate.completed !== 'boolean'
  ) {
    throw new Error('The setup state is invalid.');
  }
  const completedAt = candidate.completedAt;
  if (
    completedAt !== undefined &&
    (typeof completedAt !== 'string' ||
      completedAt.length === 0 ||
      completedAt.length > MAX_TIMESTAMP_LENGTH ||
      Number.isNaN(Date.parse(completedAt)))
  ) {
    throw new Error('The setup state is invalid.');
  }
  const completedBy = candidate.completedBy;
  if (
    completedBy !== undefined &&
    (typeof completedBy !== 'string' ||
      !SETUP_COMPLETION_SOURCES.includes(completedBy as SetupCompletionSource))
  ) {
    throw new Error('The setup state is invalid.');
  }
  let progress: SetupProgress | undefined;
  if (candidate.progress !== undefined) {
    const p = candidate.progress as Record<string, unknown>;
    // `completed` and `progress` are independent: the first records that setup finished at
    // some point, the second where an open wizard currently is. A rerun on a configured
    // installation legitimately carries both, and launch detection checks `completed` first.
    if (
      !p ||
      typeof p !== 'object' ||
      Array.isArray(p) ||
      !SETUP_STEP_IDS.includes(p.stepId as SetupStepId) ||
      typeof p.rerun !== 'boolean' ||
      (Boolean(candidate.completed) && p.rerun !== true)
    ) {
      throw new Error('The setup progress is invalid.');
    }
    progress = {
      stepId: p.stepId as SetupStepId,
      selections: parseSetupSelections(p.selections),
      rerun: p.rerun,
    };
  }
  return {
    version: candidate.version,
    completed: candidate.completed,
    ...(completedAt ? { completedAt } : {}),
    ...(completedBy ? { completedBy: completedBy as SetupCompletionSource } : {}),
    ...(progress ? { progress } : {}),
  };
};

export type { TestProviderConnectionInput, TestProviderConnectionResult };
