import type { SetupSelections, SetupVoice } from '../core/setup/setup-flow';
import { RESOURCE_DEFINITIONS } from './resource-catalog';
import type { SpeechAssetDownloadStatus, SpeechAssetTierId } from './speech-asset-ipc';

export interface SetupResourceEntry {
  id: SpeechAssetTierId;
  name: string;
  license: string;
  language: string;
  downloadBytes: number;
  installedBytes: number;
  available: boolean;
}
export interface SetupResourceStatus {
  resources: SetupResourceEntry[];
  downloads: SpeechAssetDownloadStatus;
}
export interface SetupResourceControl {
  action: 'start' | 'pause' | 'resume' | 'skip';
  allowMetered: boolean;
}
export const parseSetupResourceControl = (value: unknown): SetupResourceControl => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('资源操作无效。');
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some((k) => !['action', 'allowMetered'].includes(k)) ||
    !['start', 'pause', 'resume', 'skip'].includes(v.action as string) ||
    typeof v.allowMetered !== 'boolean'
  ) {
    throw new Error('资源操作无效。');
  }
  return {
    action: v.action as SetupResourceControl['action'],
    allowMetered: v.allowMetered,
  };
};

/**
 * The one asset each wizard voice starts from. Everything else it needs — engine, base model,
 * pronunciation dictionary — is reached through the catalog's own dependency links, so a voice
 * added here picks up its dependencies and its download size without a second edit.
 */
export const SETUP_VOICE_ASSETS: Readonly<Partial<Record<SetupVoice, SpeechAssetTierId>>> =
  Object.freeze({
    genie: 'voice-genie-mika',
    'genie-feibi': 'voice-genie-feibi',
    'genie-thirtyseven': 'voice-genie-thirtyseven',
    ireina: 'voice-runtime',
  });

/** Fixed application-owned combinations; dependency links can contain cycles. */
export const setupResourceIds = (s: SetupSelections): SpeechAssetTierId[] => {
  const ids = new Set<SpeechAssetTierId>();
  const visit = (id: SpeechAssetTierId): void => {
    if (ids.has(id)) return;
    ids.add(id);
    RESOURCE_DEFINITIONS[id].dependencies.forEach(visit);
  };
  const voiceAsset = SETUP_VOICE_ASSETS[s.voice];
  if (voiceAsset) visit(voiceAsset);
  if (s.speechInput) visit('speech-input');
  return [...ids];
};
