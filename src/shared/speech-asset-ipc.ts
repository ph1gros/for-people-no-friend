export const SPEECH_ASSET_TIER_IDS = ['voice-runtime', 'speech-input'] as const;
export type SpeechAssetTierId = (typeof SPEECH_ASSET_TIER_IDS)[number];

export const SPEECH_ASSET_ACTIONS = ['start', 'pause', 'resume', 'cancel'] as const;
export type SpeechAssetAction = (typeof SPEECH_ASSET_ACTIONS)[number];

export interface SpeechAssetControlInput {
  tierId: SpeechAssetTierId;
  action: SpeechAssetAction;
}

export interface SpeechAssetTierStatus {
  id: SpeechAssetTierId;
  version: string;
  state: 'pending' | 'downloading' | 'paused' | 'ready' | 'error';
  downloadedBytes: number;
  totalBytes: number;
  message?: string;
}

export interface SpeechAssetDownloadStatus {
  sourceConfigured: boolean;
  metered: boolean;
  meteredUnknown?: boolean;
  busy: boolean;
  tiers: SpeechAssetTierStatus[];
  message?: string;
}

export const parseSpeechAssetControlInput = (value: unknown): SpeechAssetControlInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The speech asset command is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    typeof record.tierId !== 'string' ||
    !SPEECH_ASSET_TIER_IDS.includes(record.tierId as SpeechAssetTierId) ||
    typeof record.action !== 'string' ||
    !SPEECH_ASSET_ACTIONS.includes(record.action as SpeechAssetAction)
  ) {
    throw new Error('The speech asset command is invalid.');
  }
  return { tierId: record.tierId as SpeechAssetTierId, action: record.action as SpeechAssetAction };
};
