import type { SpeechAssetTierId } from '../../shared/speech-asset-ipc';
import type { SpeechAssetTarget } from './speech-asset-layout';

export interface SpeechAssetIntegrity {
  readonly version: string;
  readonly target: SpeechAssetTarget;
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
  'genie-language-data': Object.freeze({
    version: '1.0.0',
    target: 'genie-language-data',
    sha256: '9f3e5cd38ba6b51d2b6997a2ba05a15e9cba1a90397b809c704e5934a5d80d90',
    compressedBytes: 13182009,
    extractedBytes: 36727353,
    maxEntries: 15,
  }),
  'voice-genie-feibi': Object.freeze({
    version: '1.0.0',
    target: 'voice-genie-feibi',
    sha256: '740cf5cccb2ac35d5ac9ad1da001c4fa2f08581453179a53e25c9d5f8a53177e',
    compressedBytes: 305343100,
    extractedBytes: 336375916,
    maxEntries: 12,
  }),
  'voice-genie-thirtyseven': Object.freeze({
    version: '1.0.0',
    target: 'voice-genie-thirtyseven',
    sha256: '2055cd88dfd68cea4c169b69ee5409d0157ed4189ba192028a41d6d0475f7aa3',
    compressedBytes: 305779395,
    extractedBytes: 336955328,
    maxEntries: 14,
  }),
  'voice-runtime': Object.freeze({
    version: '1.0.0',
    target: 'voice-runtime',
    sha256: '5fe6b2071c5ffbbf2784f6e495cd1239803da873b398838e343acd34d2b356c1',
    compressedBytes: 133853592,
    extractedBytes: 431733455,
    maxEntries: 6832,
  }),
  'speech-input': Object.freeze({
    version: '1.0.0',
    target: 'speech-input-runtime',
    sha256: '5a0c8e8dd0d208f85f1b030927f3a3eaef4cfbe69ecbcb17881df712bc9b1204',
    compressedBytes: 160310562,
    extractedBytes: 239560934,
    maxEntries: 6,
  }),
  'bert-japanese': Object.freeze({
    version: '1.0.0',
    target: 'bert-japanese',
    sha256: '5f184eb00260f33355f02aafa85ecab51468d3a87fdf088fe907d61a15b028be',
    compressedBytes: 365027764,
    extractedBytes: 408491314,
    maxEntries: 10,
  }),
  'voice-ireina': Object.freeze({
    version: '1.0.0',
    target: 'voice-ireina',
    sha256: 'a52819b361d24d5589af0b74f2c10a7fed27b963668a6b4a0be35729765eba1c',
    compressedBytes: 231253343,
    extractedBytes: 249421901,
    maxEntries: 5,
  }),
  'genie-tts': Object.freeze({
    version: '1.1.2',
    target: 'genie-tts',
    sha256: '91877a3e0b22ee5f4c1923fe8224b171dbdee95216dfe07f17051fdacd680eb7',
    compressedBytes: 202524099,
    extractedBytes: 612300086,
    maxEntries: 14075,
  }),
  'genie-data': Object.freeze({
    version: '1.0.0',
    target: 'genie-data',
    sha256: '00eabb06e106513ffd480b4ad572a033b099fb03424db6ecbe14a7a6a743a81f',
    compressedBytes: 283237298,
    extractedBytes: 373792956,
    maxEntries: 4,
  }),
  'voice-genie-mika': Object.freeze({
    version: '1.0.0',
    target: 'voice-genie-mika',
    sha256: '2d51332862f897ccc8a9c293a0314e2086d51d8a136376de8b02ea28403cd0e2',
    compressedBytes: 305533156,
    extractedBytes: 336874992,
    maxEntries: 14,
  }),
});
