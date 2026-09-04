import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { SpeechAssetTierId } from '../../shared/speech-asset-ipc';
import { SPEECH_ASSET_INTEGRITY } from './speech-asset-integrity';

/** A local receipt is compared with compiled trust anchors, never used to define them. */
export const isSpeechAssetActivated = async (
  speechAssetsRoot: string,
  id: SpeechAssetTierId,
): Promise<boolean> => {
  const integrity = SPEECH_ASSET_INTEGRITY[id];
  if (!integrity) return false;
  const markerPath = path.join(speechAssetsRoot, 'active', `${id}.json`);
  try {
    const details = await lstat(markerPath);
    if (!details.isFile() || details.isSymbolicLink() || details.size > 4096) return false;
    const value: unknown = JSON.parse(await readFile(markerPath, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const marker = value as Record<string, unknown>;
    return (
      Object.keys(marker).sort().join(',') === 'schemaVersion,sha256,version' &&
      marker.schemaVersion === 2 &&
      marker.version === integrity.version &&
      marker.sha256 === integrity.sha256
    );
  } catch {
    return false;
  }
};
