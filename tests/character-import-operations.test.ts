import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  confirmCharacterPackageImport,
  importLive2DModelFile,
  previewCharacterPackageFile,
  type CharacterImportDependencies,
} from '../src/main/character/character-import-operations';
import { MAX_CHARACTER_PACKAGE_BYTES } from '../src/main/character/character-package-archive';

describe('shared character import operations', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  const createDirectory = async (): Promise<string> => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-character-import-'));
    return directory;
  };

  it('reports a missing service instead of throwing', async () => {
    const dependencies: CharacterImportDependencies = {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    };

    await expect(previewCharacterPackageFile(dependencies)).resolves.toEqual({
      ok: false,
      canceled: false,
      message: '角色包服务不可用。',
    });
    await expect(importLive2DModelFile(dependencies)).resolves.toEqual({
      ok: false,
      canceled: false,
      message: 'Live2D 模型导入服务不可用。',
    });
  });

  it('treats a cancelled dialog as a cancellation, not a failure', async () => {
    const onCharacterChanging = vi.fn();
    const dependencies: CharacterImportDependencies = {
      onCharacterChanging,
      characterPackages: { preview: vi.fn() } as never,
      live2DModelImports: { importModel: vi.fn() } as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    };

    await expect(previewCharacterPackageFile(dependencies)).resolves.toEqual({
      ok: true,
      canceled: true,
    });
    await expect(importLive2DModelFile(dependencies)).resolves.toEqual({
      ok: true,
      canceled: true,
    });
    expect(onCharacterChanging).not.toHaveBeenCalled();
    expect(dependencies.live2DModelImports!.importModel).not.toHaveBeenCalled();
  });

  it('rejects an oversized package before it reaches the parser', async () => {
    const root = await createDirectory();
    const filePath = path.join(root, 'huge.zip');
    await writeFile(filePath, Buffer.alloc(1024), 'binary');
    const preview = vi.fn();
    const dependencies: CharacterImportDependencies = {
      characterPackages: { preview } as never,
      showOpenDialog: async () => ({ canceled: false, filePaths: [filePath] }),
    };
    // Pretend the file exceeds the limit by checking the constant the operation enforces.
    await writeFile(filePath, Buffer.alloc(MAX_CHARACTER_PACKAGE_BYTES + 1), 'binary');

    await expect(previewCharacterPackageFile(dependencies)).resolves.toEqual({
      ok: false,
      canceled: false,
      message: '角色包无效、不兼容、过大，或包含不安全文件。',
    });
    expect(preview).not.toHaveBeenCalled();
  });

  it('passes a valid selection to the package service and returns its preview', async () => {
    const root = await createDirectory();
    const filePath = path.join(root, 'character.zip');
    await writeFile(filePath, Buffer.from([1, 2, 3]));
    const previewResult = { previewId: 'abc', characterName: '示例角色' };
    const dependencies: CharacterImportDependencies = {
      characterPackages: { preview: async () => previewResult } as never,
      showOpenDialog: async () => ({ canceled: false, filePaths: [filePath] }),
    };

    await expect(previewCharacterPackageFile(dependencies)).resolves.toEqual({
      ok: true,
      canceled: false,
      preview: previewResult,
    });
  });

  it('surfaces a confirmation failure as a message', async () => {
    const dependencies: CharacterImportDependencies = {
      characterPackages: {
        confirmImport: async () => {
          throw new Error('角色包已过期。');
        },
      } as never,
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    };

    await expect(
      confirmCharacterPackageImport(dependencies, { previewId: 'abc', replaceExisting: false }),
    ).resolves.toEqual({ ok: false, canceled: false, message: '角色包已过期。' });
  });

  it('returns the imported Live2D model summary', async () => {
    const onCharacterChanging = vi.fn();
    const dependencies: CharacterImportDependencies = {
      onCharacterChanging,
      live2DModelImports: {
        importModel: async () => {
          expect(onCharacterChanging).toHaveBeenCalledOnce();
          return { modelName: '示例模型', assetCount: 4, importedBytes: 1024 };
        },
      } as never,
      showOpenDialog: async () => ({ canceled: false, filePaths: ['C:/models/a.model3.json'] }),
    };

    await expect(importLive2DModelFile(dependencies)).resolves.toEqual({
      ok: true,
      canceled: false,
      modelName: '示例模型',
      assetCount: 4,
      importedBytes: 1024,
    });
  });
});
