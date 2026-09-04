import type { SpeechAssetTierId } from '../../shared/speech-asset-ipc';

export interface SpeechAssetIntegrity {
  readonly version: string;
  readonly target: 'voice-runtime' | 'speech-input-runtime';
  readonly sha256: string;
  readonly compressedBytes: number;
  readonly extractedBytes: number;
  readonly maxEntries: number;
}

/**
 * Application-owned trust anchors. Remote manifests may supply URLs only.
 * null disables a tier until its approved release archive has been measured.
 * Do not populate these entries from files, environment variables, IPC or the network.
 * Updating an archive requires updating this source and distributing a new application.
 * Freeze each populated entry as well as this table.
 */
export const SPEECH_ASSET_INTEGRITY: Readonly<
  Record<SpeechAssetTierId, Readonly<SpeechAssetIntegrity> | null>
> = Object.freeze({
  'voice-runtime': null,
  'speech-input': null,
});
