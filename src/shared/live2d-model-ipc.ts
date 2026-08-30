export type Live2DModelImportResult =
  | { ok: true; canceled: true }
  | {
      ok: true;
      canceled: false;
      modelName: string;
      assetCount: number;
      importedBytes: number;
    }
  | { ok: false; canceled: false; message: string };

export type { Live2DModelExportResult } from './local-asset-ipc';
