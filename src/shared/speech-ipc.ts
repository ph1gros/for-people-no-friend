export const SPEECH_PROVIDER_IDS = ['disabled', 'openai-compatible'] as const;
export type SpeechProviderId = (typeof SPEECH_PROVIDER_IDS)[number];

export const SPEECH_AUDIO_FORMATS = ['wav', 'mp3', 'opus', 'aac', 'flac'] as const;
export type SpeechAudioFormat = (typeof SPEECH_AUDIO_FORMATS)[number];
export const SPEECH_INPUT_MODES = ['full', 'half', 'manual'] as const;
export type SpeechInputMode = (typeof SPEECH_INPUT_MODES)[number];
export const SPEECH_PUSH_TO_TALK_KEYS = [
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'CapsLock',
  'Backquote',
] as const;
export type SpeechPushToTalkKey = (typeof SPEECH_PUSH_TO_TALK_KEYS)[number];

export const MAX_SPEECH_TEXT_LENGTH = 600;
export const MAX_SPEECH_AUDIO_BYTES = 16 * 1024 * 1024;
export const MAX_SPEECH_INPUT_AUDIO_BYTES = 2 * 1024 * 1024;
export const SPEECH_INPUT_MIME_TYPES = ['audio/wav', 'audio/x-wav', 'audio/wave'] as const;

export interface SpeechSettings {
  enabled: boolean;
  providerId: SpeechProviderId;
  baseUrl: string;
  modelId: string;
  voiceId: string;
  language: string;
  responseFormat: SpeechAudioFormat;
  speed: number;
  volume: number;
  inputEnabled: boolean;
  inputMode: SpeechInputMode;
  pushToTalkKey: SpeechPushToTalkKey;
  transcriptionBaseUrl: string;
  transcriptionModelId: string;
  transcriptionLanguage: string;
}

export const DEFAULT_SPEECH_SETTINGS: Readonly<SpeechSettings> = Object.freeze({
  enabled: false,
  providerId: 'openai-compatible',
  baseUrl: 'http://127.0.0.1:9881/v1',
  modelId: 'ireina',
  voiceId: 'ireina',
  language: 'ja-JP',
  responseFormat: 'wav',
  speed: 0.9,
  volume: 0.6,
  inputEnabled: false,
  inputMode: 'manual',
  pushToTalkKey: 'F8',
  transcriptionBaseUrl: 'http://127.0.0.1:9880/v1',
  transcriptionModelId: 'SenseVoiceSmall',
  transcriptionLanguage: 'zh-CN',
});

export interface SpeechProviderCapability {
  providerId: SpeechProviderId;
  displayName: string;
  configured: boolean;
  available: boolean;
  transport: 'none' | 'rest';
  dataDestination: 'none' | 'this-device' | 'remote-service';
  supportsStreamingInput: boolean;
  supportedFormats: SpeechAudioFormat[];
  detail: string;
}

export interface SpeechStatus {
  settings: SpeechSettings;
  apiKeySaved: boolean;
  output: SpeechProviderCapability;
  input: {
    available: boolean;
    modes: SpeechInputMode[];
    dataDestination: 'none' | 'this-device' | 'remote-service';
    detail: string;
  };
}

export interface SetSpeechSettingsInput {
  settings: SpeechSettings;
}

export interface SetSpeechSecretInput {
  apiKey: string;
}

export interface SpeechSynthesisInput {
  requestId: string;
  text: string;
}

export interface CancelSpeechInput {
  requestId: string;
}

export interface SpeechTranscriptionInput {
  requestId: string;
  audio: Uint8Array;
  mimeType: (typeof SPEECH_INPUT_MIME_TYPES)[number];
}

export type SpeechTranscriptionResult =
  | { ok: true; requestId: string; text: string }
  | { ok: false; requestId: string; cancelled: boolean; message: string };

export type SpeechOperationResult = { ok: true } | { ok: false; message: string };

export type SpeechSynthesisResult =
  | {
      ok: true;
      requestId: string;
      audio: Uint8Array;
      mimeType: string;
      text: string;
    }
  | {
      ok: false;
      requestId: string;
      cancelled: boolean;
      message: string;
    };

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/u;
const containsControlCharacters = (value: string, allowLineBreaks = false): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint === 0x7f ||
      (codePoint <= 0x1f && (!allowLineBreaks || ![0x09, 0x0a, 0x0d].includes(codePoint)))
    );
  });

const objectRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The speech input is invalid.');
  }
  return value as Record<string, unknown>;
};

const hasOnlyKeys = (record: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(record).every((key) => allowed.includes(key));

export const parseSpeechSettings = (value: unknown): SpeechSettings => {
  const record = objectRecord(value);
  if (
    !hasOnlyKeys(record, [
      'enabled',
      'providerId',
      'baseUrl',
      'modelId',
      'voiceId',
      'language',
      'responseFormat',
      'speed',
      'volume',
      'inputEnabled',
      'inputMode',
      'pushToTalkKey',
      'transcriptionBaseUrl',
      'transcriptionModelId',
      'transcriptionLanguage',
    ]) ||
    typeof record.enabled !== 'boolean' ||
    typeof record.providerId !== 'string' ||
    !SPEECH_PROVIDER_IDS.includes(record.providerId as SpeechProviderId) ||
    typeof record.baseUrl !== 'string' ||
    !record.baseUrl.trim() ||
    record.baseUrl.length > 2_048 ||
    containsControlCharacters(record.baseUrl.trim()) ||
    typeof record.modelId !== 'string' ||
    record.modelId.length > 256 ||
    containsControlCharacters(record.modelId.trim()) ||
    typeof record.voiceId !== 'string' ||
    record.voiceId.length > 256 ||
    containsControlCharacters(record.voiceId.trim()) ||
    typeof record.language !== 'string' ||
    !LANGUAGE_PATTERN.test(record.language.trim()) ||
    typeof record.responseFormat !== 'string' ||
    !SPEECH_AUDIO_FORMATS.includes(record.responseFormat as SpeechAudioFormat) ||
    typeof record.speed !== 'number' ||
    !Number.isFinite(record.speed) ||
    record.speed < 0.25 ||
    record.speed > 4 ||
    (record.volume !== undefined &&
      (typeof record.volume !== 'number' ||
        !Number.isFinite(record.volume) ||
        record.volume < 0 ||
        record.volume > 1)) ||
    (record.inputEnabled !== undefined && typeof record.inputEnabled !== 'boolean') ||
    (record.inputMode !== undefined &&
      (typeof record.inputMode !== 'string' ||
        !SPEECH_INPUT_MODES.includes(record.inputMode as SpeechInputMode))) ||
    (record.pushToTalkKey !== undefined &&
      (typeof record.pushToTalkKey !== 'string' ||
        !SPEECH_PUSH_TO_TALK_KEYS.includes(record.pushToTalkKey as SpeechPushToTalkKey))) ||
    (record.transcriptionBaseUrl !== undefined &&
      (typeof record.transcriptionBaseUrl !== 'string' ||
        !record.transcriptionBaseUrl.trim() ||
        record.transcriptionBaseUrl.length > 2_048 ||
        containsControlCharacters(record.transcriptionBaseUrl.trim()))) ||
    (record.transcriptionModelId !== undefined &&
      (typeof record.transcriptionModelId !== 'string' ||
        record.transcriptionModelId.length > 256 ||
        containsControlCharacters(record.transcriptionModelId.trim()))) ||
    (record.transcriptionLanguage !== undefined &&
      (typeof record.transcriptionLanguage !== 'string' ||
        !LANGUAGE_PATTERN.test(record.transcriptionLanguage.trim())))
  ) {
    throw new Error('The speech settings are invalid.');
  }
  const providerId = record.providerId as SpeechProviderId;
  const modelId = record.modelId.trim();
  const voiceId = record.voiceId.trim();
  const inputEnabled = record.inputEnabled ?? DEFAULT_SPEECH_SETTINGS.inputEnabled;
  const inputMode =
    typeof record.inputMode === 'string'
      ? (record.inputMode as SpeechInputMode)
      : DEFAULT_SPEECH_SETTINGS.inputMode;
  const pushToTalkKey =
    typeof record.pushToTalkKey === 'string'
      ? (record.pushToTalkKey as SpeechPushToTalkKey)
      : DEFAULT_SPEECH_SETTINGS.pushToTalkKey;
  const volume = record.volume ?? DEFAULT_SPEECH_SETTINGS.volume;
  const transcriptionBaseUrl =
    typeof record.transcriptionBaseUrl === 'string'
      ? record.transcriptionBaseUrl.trim()
      : DEFAULT_SPEECH_SETTINGS.transcriptionBaseUrl;
  const transcriptionModelId =
    typeof record.transcriptionModelId === 'string'
      ? record.transcriptionModelId.trim()
      : DEFAULT_SPEECH_SETTINGS.transcriptionModelId;
  const transcriptionLanguage =
    typeof record.transcriptionLanguage === 'string'
      ? record.transcriptionLanguage.trim()
      : DEFAULT_SPEECH_SETTINGS.transcriptionLanguage;
  if (record.enabled && (providerId === 'disabled' || !modelId || !voiceId)) {
    throw new Error('An enabled speech provider requires a model and voice.');
  }
  if (inputEnabled && !transcriptionModelId) {
    throw new Error('Enabled speech input requires a transcription model.');
  }
  return {
    enabled: record.enabled,
    providerId,
    baseUrl: record.baseUrl.trim(),
    modelId,
    voiceId,
    language: record.language.trim(),
    responseFormat: record.responseFormat as SpeechAudioFormat,
    speed: record.speed,
    volume,
    inputEnabled,
    inputMode,
    pushToTalkKey,
    transcriptionBaseUrl,
    transcriptionModelId,
    transcriptionLanguage,
  };
};

export const parseSetSpeechSettingsInput = (value: unknown): SetSpeechSettingsInput => {
  const record = objectRecord(value);
  if (!hasOnlyKeys(record, ['settings'])) throw new Error('The speech settings input is invalid.');
  return { settings: parseSpeechSettings(record.settings) };
};

export const parseSetSpeechSecretInput = (value: unknown): SetSpeechSecretInput => {
  const record = objectRecord(value);
  if (
    !hasOnlyKeys(record, ['apiKey']) ||
    typeof record.apiKey !== 'string' ||
    !record.apiKey.trim() ||
    record.apiKey.length > 32_768 ||
    /^\*+$/u.test(record.apiKey.trim())
  ) {
    throw new Error('A non-empty, unmasked speech API key is required.');
  }
  return { apiKey: record.apiKey.trim() };
};

export const parseSpeechSynthesisInput = (value: unknown): SpeechSynthesisInput => {
  const record = objectRecord(value);
  if (
    !hasOnlyKeys(record, ['requestId', 'text']) ||
    typeof record.requestId !== 'string' ||
    !REQUEST_ID_PATTERN.test(record.requestId) ||
    typeof record.text !== 'string' ||
    !record.text.trim() ||
    record.text.length > MAX_SPEECH_TEXT_LENGTH ||
    containsControlCharacters(record.text, true)
  ) {
    throw new Error('The speech synthesis request is invalid.');
  }
  return { requestId: record.requestId, text: record.text.trim() };
};

export const parseCancelSpeechInput = (value: unknown): CancelSpeechInput => {
  const record = objectRecord(value);
  if (
    !hasOnlyKeys(record, ['requestId']) ||
    typeof record.requestId !== 'string' ||
    !REQUEST_ID_PATTERN.test(record.requestId)
  ) {
    throw new Error('The speech cancellation request is invalid.');
  }
  return { requestId: record.requestId };
};

export const parseSpeechTranscriptionInput = (value: unknown): SpeechTranscriptionInput => {
  const record = objectRecord(value);
  if (
    !hasOnlyKeys(record, ['requestId', 'audio', 'mimeType']) ||
    typeof record.requestId !== 'string' ||
    !REQUEST_ID_PATTERN.test(record.requestId) ||
    !(record.audio instanceof Uint8Array) ||
    record.audio.byteLength === 0 ||
    record.audio.byteLength > MAX_SPEECH_INPUT_AUDIO_BYTES ||
    typeof record.mimeType !== 'string' ||
    !SPEECH_INPUT_MIME_TYPES.includes(record.mimeType as (typeof SPEECH_INPUT_MIME_TYPES)[number])
  ) {
    throw new Error('The speech transcription request is invalid.');
  }
  return {
    requestId: record.requestId,
    audio: record.audio,
    mimeType: record.mimeType as (typeof SPEECH_INPUT_MIME_TYPES)[number],
  };
};

export const parseSpeechSynthesisResult = (value: unknown): SpeechSynthesisResult => {
  const record = objectRecord(value);
  const requestId = record.requestId;
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error('The speech synthesis result is invalid.');
  }
  if (record.ok === false) {
    if (typeof record.cancelled !== 'boolean' || typeof record.message !== 'string') {
      throw new Error('The speech synthesis result is invalid.');
    }
    return {
      ok: false,
      requestId,
      cancelled: record.cancelled,
      message: record.message.slice(0, 300),
    };
  }
  const audio = record.audio;
  if (
    record.ok !== true ||
    !(audio instanceof Uint8Array) ||
    audio.byteLength === 0 ||
    audio.byteLength > MAX_SPEECH_AUDIO_BYTES ||
    typeof record.mimeType !== 'string' ||
    !record.mimeType.startsWith('audio/') ||
    record.mimeType.length > 64 ||
    typeof record.text !== 'string' ||
    !record.text ||
    record.text.length > MAX_SPEECH_TEXT_LENGTH
  ) {
    throw new Error('The speech synthesis result is invalid.');
  }
  return { ok: true, requestId, audio, mimeType: record.mimeType, text: record.text };
};

export const parseSpeechTranscriptionResult = (value: unknown): SpeechTranscriptionResult => {
  const record = objectRecord(value);
  const requestId = record.requestId;
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error('The speech transcription result is invalid.');
  }
  if (record.ok === false) {
    if (typeof record.cancelled !== 'boolean' || typeof record.message !== 'string') {
      throw new Error('The speech transcription result is invalid.');
    }
    return {
      ok: false,
      requestId,
      cancelled: record.cancelled,
      message: record.message.slice(0, 300),
    };
  }
  if (
    record.ok !== true ||
    typeof record.text !== 'string' ||
    !record.text.trim() ||
    record.text.length > 8_000 ||
    containsControlCharacters(record.text, true)
  ) {
    throw new Error('The speech transcription result is invalid.');
  }
  return { ok: true, requestId, text: record.text.trim() };
};
