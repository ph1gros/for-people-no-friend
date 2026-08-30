export interface LocalSpeechAssetStatus {
  voiceName: string;
  voiceAvailable: boolean;
  voiceFileCount: number;
  voiceBytes: number;
  styles: string[];
  trainingToolAvailable: boolean;
  trainingSourceReady: boolean;
}

export interface ConfirmAuthorizedVoiceUseInput {
  confirmedRights: boolean;
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

export const parseConfirmAuthorizedVoiceUseInput = (
  value: unknown,
): ConfirmAuthorizedVoiceUseInput => {
  if (
    !value ||
    typeof value !== 'object' ||
    !('confirmedRights' in value) ||
    value.confirmedRights !== true
  ) {
    throw new Error('开始处理音色前，需要确认声音素材的使用权。');
  }
  return { confirmedRights: true };
};
