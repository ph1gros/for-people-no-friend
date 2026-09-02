export interface LocalSpeechAssetStatus {
  voiceName: string;
  voiceAvailable: boolean;
  voiceFileCount: number;
  voiceBytes: number;
  styles: string[];
  trainingToolAvailable: boolean;
  trainingSourceReady: boolean;
}

export type LocalAssetOperationResult =
  | { ok: true; canceled: true }
  | { ok: true; canceled: false; message: string }
  | { ok: false; canceled: false; message: string };

export type Live2DModelExportResult =
  | { ok: true; canceled: true }
  | {
      ok: true;
      canceled: false;
      modelName: string;
      assetCount: number;
      exportedBytes: number;
      message: string;
    }
  | { ok: false; canceled: false; message: string };
