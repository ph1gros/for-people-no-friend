import type { SetupSelections } from '../core/setup/setup-flow';
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
  return { action: v.action as SetupResourceControl['action'], allowMetered: v.allowMetered };
};

/** Fixed application-owned combinations; dependency links can contain cycles. */
export const setupResourceIds = (s: SetupSelections): SpeechAssetTierId[] => {
  const ids = new Set<SpeechAssetTierId>();
  const visit = (id: SpeechAssetTierId): void => {
    if (ids.has(id)) return;
    ids.add(id);
    RESOURCE_DEFINITIONS[id].dependencies.forEach(visit);
  };
  if (s.voice === 'genie') visit('genie-tts');
  if (s.voice === 'ireina') visit('voice-runtime');
  if (s.speechInput) visit('speech-input');
  return [...ids];
};
