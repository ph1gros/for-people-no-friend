import { readFile, stat } from 'node:fs/promises';

import type { OpenDialogOptions, OpenDialogReturnValue } from 'electron';

import type {
  CharacterPackageFileResult,
  ConfirmCharacterPackageImportInput,
} from '../../shared/character-package-ipc';
import type { Live2DModelImportResult } from '../../shared/live2d-model-ipc';
import type { Live2DModelImportService } from '../live2d/live2d-model-import-service';

import { MAX_CHARACTER_PACKAGE_BYTES } from './character-package-archive';
import type { CharacterPackageService } from './character-package-service';

/**
 * The character import steps shared by the settings panel and the setup wizard, so both
 * surfaces enforce the same dialog filters, size limit and failure messages.
 */
export interface CharacterImportDependencies {
  isActive?: () => boolean;
  characterPackages?: CharacterPackageService;
  live2DModelImports?: Live2DModelImportService;
  showOpenDialog: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;
}

export const previewCharacterPackageFile = async (
  dependencies: CharacterImportDependencies,
): Promise<CharacterPackageFileResult> => {
  const { characterPackages } = dependencies;
  if (!characterPackages) {
    return { ok: false, canceled: false, message: '角色包服务不可用。' };
  }
  const selection = await dependencies.showOpenDialog({
    title: '预览角色包',
    properties: ['openFile'],
    filters: [{ name: 'For People No Friend 角色包', extensions: ['zip'] }],
  });
  if (selection.canceled || !selection.filePaths[0] || dependencies.isActive?.() === false)
    return { ok: true, canceled: true };
  try {
    const filePath = selection.filePaths[0];
    if ((await stat(filePath)).size > MAX_CHARACTER_PACKAGE_BYTES) throw new Error();
    return {
      ok: true,
      canceled: false,
      preview: await characterPackages.preview(new Uint8Array(await readFile(filePath))),
    };
  } catch {
    return {
      ok: false,
      canceled: false,
      message: '角色包无效、不兼容、过大，或包含不安全文件。',
    };
  }
};

export const confirmCharacterPackageImport = async (
  dependencies: CharacterImportDependencies,
  input: ConfirmCharacterPackageImportInput,
): Promise<CharacterPackageFileResult> => {
  const { characterPackages } = dependencies;
  if (!characterPackages) {
    return { ok: false, canceled: false, message: '角色包服务不可用。' };
  }
  try {
    await characterPackages.confirmImport(input.previewId, input.replaceExisting);
    return { ok: true, canceled: false };
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      message: error instanceof Error ? error.message : '角色包导入失败。',
    };
  }
};

export const importLive2DModelFile = async (
  dependencies: CharacterImportDependencies,
): Promise<Live2DModelImportResult> => {
  const { live2DModelImports } = dependencies;
  if (!live2DModelImports) {
    return { ok: false, canceled: false, message: 'Live2D 模型导入服务不可用。' };
  }
  const selection = await dependencies.showOpenDialog({
    title: '导入 Live2D 模型',
    properties: ['openFile'],
    filters: [{ name: 'Live2D Cubism 模型（.model3.json）', extensions: ['json'] }],
  });
  if (selection.canceled || !selection.filePaths[0] || dependencies.isActive?.() === false) {
    return { ok: true, canceled: true };
  }
  try {
    const imported = await live2DModelImports.importModel(selection.filePaths[0]);
    return { ok: true, canceled: false, ...imported };
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      message: error instanceof Error ? error.message : 'Live2D 模型导入失败。',
    };
  }
};
