import { randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import type { CharacterProfileStore } from '../storage/character-profile-store';

interface ImportedLive2DModel {
  modelId: string;
  characterId: string;
  modelName: string;
  modelManifest: string;
  assetPaths: string[];
}

interface Live2DModelRegistry {
  version: 1;
  models: ImportedLive2DModel[];
}

export interface ImportedLive2DModelResult {
  modelName: string;
  assetCount: number;
  importedBytes: number;
}

export interface ExportedLive2DModelResult {
  modelName: string;
  assetCount: number;
  exportedBytes: number;
  directoryName: string;
}

const MAX_MODEL_FILES = 2_000;
const MAX_MODEL_FILE_BYTES = 128 * 1024 * 1024;
const MAX_MODEL_TOTAL_BYTES = 512 * 1024 * 1024;
const MODEL_ID_PATTERN = /^[a-f0-9-]{36}$/u;
const SAFE_REFERENCE_EXTENSION = /\.(?:json|moc3|png|jpe?g|webp|wav|mp3|ogg)$/iu;

const isMissingFile = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isSafeRelativePath = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 220 &&
  !value.includes('\\') &&
  !value.startsWith('/') &&
  !value.split('/').includes('..') &&
  !/^[a-z][a-z\d+.-]*:/iu.test(value);

const normalizeModelName = (fileName: string): string => {
  const name = fileName
    .replace(/\.model3\.json$/iu, '')
    .normalize('NFKC')
    .trim()
    .slice(0, 80);
  return name || 'Live2D 模型';
};

const staysWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
};

const safeDirectoryName = (value: string): string =>
  [...value.normalize('NFKC')]
    .map((character) =>
      character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '-' : character,
    )
    .join('')
    .replace(/[. ]+$/gu, '')
    .trim()
    .slice(0, 64) || 'Live2D-模型';

const createUniqueDirectory = async (parent: string, baseName: string): Promise<string> => {
  for (let index = 0; index < 100; index += 1) {
    const candidate = path.join(parent, index === 0 ? baseName : `${baseName}-${index + 1}`);
    try {
      await mkdir(candidate, { recursive: false });
      return candidate;
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') {
        throw error;
      }
    }
  }
  throw new Error('所选文件夹中已有过多同名模型导出。');
};

export class Live2DModelImportService {
  private readonly modelsRoot: string;
  private readonly registryPath: string;
  private registry: Live2DModelRegistry | undefined;

  public constructor(
    userDataPath: string,
    private readonly profiles: CharacterProfileStore,
  ) {
    this.modelsRoot = path.join(userDataPath, 'live2d-models');
    this.registryPath = path.join(userDataPath, 'live2d-models.v1.json');
  }

  public async importModel(modelFilePath: string): Promise<ImportedLive2DModelResult> {
    if (!modelFilePath.toLowerCase().endsWith('.model3.json')) {
      throw new Error('请选择 Cubism 3、4 或 5 的 .model3.json 文件。');
    }
    const selectedStats = await lstat(modelFilePath);
    if (!selectedStats.isFile() || selectedStats.isSymbolicLink()) {
      throw new Error('所选模型文件无效。');
    }

    const selectedFile = await realpath(modelFilePath);
    const sourceRoot = await realpath(path.dirname(selectedFile));
    const modelRelativePath = path.basename(selectedFile).replaceAll('\\', '/');
    const files = await this.collectReferencedFiles(sourceRoot, modelRelativePath);
    const modelName = normalizeModelName(path.basename(selectedFile));
    const modelId = randomUUID();
    const characterId = (await this.profiles.get()).id;
    const modelManifest = 'live2d/model.json';
    const manifest = {
      version: 1,
      name: modelName,
      core: 'live2dcubismcore.min.js',
      model: `model/${modelRelativePath}`,
      controls: { states: {}, actions: {}, emotions: {} },
    };
    const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
    const assetPaths = [
      modelManifest,
      ...[...files.keys()].map((relativePath) => `live2d/model/${relativePath}`),
    ];
    const finalDirectory = path.join(this.modelsRoot, modelId);
    const stagingDirectory = path.join(this.modelsRoot, `.staging-${randomUUID()}`);
    const registry = await this.loadRegistry();
    const previous = registry.models.find((item) => item.characterId === characterId);
    let installed = false;
    try {
      await mkdir(path.join(stagingDirectory, 'live2d', 'model'), { recursive: true });
      await writeFile(path.join(stagingDirectory, 'live2d', 'model.json'), manifestBytes, {
        mode: 0o600,
      });
      for (const [relativePath, content] of files) {
        const destination = path.join(
          stagingDirectory,
          'live2d',
          'model',
          ...relativePath.split('/'),
        );
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, content, { mode: 0o600 });
      }
      await rename(stagingDirectory, finalDirectory);
      installed = true;
      await this.saveRegistry({
        version: 1,
        models: [
          ...registry.models.filter((item) => item.characterId !== characterId),
          { modelId, characterId, modelName, modelManifest, assetPaths },
        ],
      });
      if (previous) {
        await rm(path.join(this.modelsRoot, previous.modelId), {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }
      return {
        modelName,
        assetCount: files.size,
        importedBytes: [...files.values()].reduce(
          (total, content) => total + content.byteLength,
          0,
        ),
      };
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true });
      if (installed) await rm(finalDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  public async resolveActiveAsset(relativePath: string): Promise<string | undefined> {
    if (!isSafeRelativePath(relativePath)) return undefined;
    const model = await this.getActiveModel();
    if (!model || !model.assetPaths.includes(relativePath)) return undefined;
    return path.join(this.modelsRoot, model.modelId, ...relativePath.split('/'));
  }

  public async getActiveModelManifest(): Promise<string | undefined> {
    return (await this.getActiveModel())?.modelManifest;
  }

  public async exportActiveModel(destinationParent: string): Promise<ExportedLive2DModelResult> {
    const model = await this.getActiveModel();
    if (!model) {
      throw new Error('当前角色没有通过 FPNF 导入的 Live2D 模型。');
    }
    const destinationRoot = await realpath(destinationParent);
    const destinationStats = await lstat(destinationRoot);
    if (!destinationStats.isDirectory() || destinationStats.isSymbolicLink()) {
      throw new Error('所选导出位置不是有效文件夹。');
    }
    const sourceRoot = await realpath(path.join(this.modelsRoot, model.modelId));
    if (destinationRoot === sourceRoot || staysWithin(sourceRoot, destinationRoot)) {
      throw new Error('不能把模型导出到它自己的源目录中。');
    }
    const modelAssets = model.assetPaths.filter((assetPath) =>
      assetPath.startsWith('live2d/model/'),
    );
    if (modelAssets.length < 3 || modelAssets.length > MAX_MODEL_FILES) {
      throw new Error('当前导入模型的素材清单不完整。');
    }
    const destination = await createUniqueDirectory(
      destinationRoot,
      `FPNF-Live2D-${safeDirectoryName(model.modelName)}`,
    );
    try {
      let exportedBytes = 0;
      for (const assetPath of modelAssets) {
        const relativePath = assetPath.slice('live2d/model/'.length);
        if (!isSafeRelativePath(relativePath)) throw new Error('模型素材清单包含不安全路径。');
        const source = path.join(sourceRoot, ...assetPath.split('/'));
        const stats = await lstat(source);
        const canonical = await realpath(source);
        if (!stats.isFile() || stats.isSymbolicLink() || !staysWithin(sourceRoot, canonical)) {
          throw new Error('模型素材包含无效、链接或越界文件。');
        }
        exportedBytes += stats.size;
        if (exportedBytes > MAX_MODEL_TOTAL_BYTES) throw new Error('模型导出大小超过 512 MiB。');
        const target = path.join(destination, ...relativePath.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(canonical, target);
      }
      return {
        modelName: model.modelName,
        assetCount: modelAssets.length,
        exportedBytes,
        directoryName: path.basename(destination),
      };
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      throw error;
    }
  }

  private async getActiveModel(): Promise<ImportedLive2DModel | undefined> {
    const [profile, registry] = await Promise.all([this.profiles.get(), this.loadRegistry()]);
    return registry.models.find((item) => item.characterId === profile.id);
  }

  private async collectReferencedFiles(
    sourceRoot: string,
    modelRelativePath: string,
  ): Promise<Map<string, Uint8Array>> {
    const pending = [modelRelativePath];
    const files = new Map<string, Uint8Array>();
    let totalBytes = 0;
    while (pending.length > 0) {
      const relativePath = pending.shift()!;
      if (files.has(relativePath)) continue;
      if (!isSafeRelativePath(relativePath) || files.size >= MAX_MODEL_FILES) {
        throw new Error('模型包含过多文件或不安全路径。');
      }
      const candidate = path.resolve(sourceRoot, ...relativePath.split('/'));
      if (!staysWithin(sourceRoot, candidate)) throw new Error('模型资源越过了所选目录。');
      const stats = await lstat(candidate);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_MODEL_FILE_BYTES) {
        throw new Error('模型包含无效、链接或过大的资源文件。');
      }
      const canonical = await realpath(candidate);
      if (!staysWithin(sourceRoot, canonical)) throw new Error('模型资源越过了所选目录。');
      const content = new Uint8Array(await readFile(canonical));
      totalBytes += content.byteLength;
      if (totalBytes > MAX_MODEL_TOTAL_BYTES) throw new Error('模型素材总大小超过 512 MiB。');
      files.set(relativePath, content);
      if (!relativePath.toLowerCase().endsWith('.json')) continue;

      let json: unknown;
      try {
        json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content));
      } catch {
        throw new Error('模型包含无法读取的 JSON 文件。');
      }
      if (relativePath === modelRelativePath && !isObject(json)) {
        throw new Error('所选 .model3.json 内容无效。');
      }
      if (relativePath === modelRelativePath) {
        const references = isObject(json) ? json.FileReferences : undefined;
        if (
          !isObject(references) ||
          typeof references.Moc !== 'string' ||
          !references.Moc.toLowerCase().endsWith('.moc3') ||
          !Array.isArray(references.Textures) ||
          references.Textures.length < 1 ||
          !references.Textures.every((texture) => typeof texture === 'string')
        ) {
          throw new Error('所选文件不是完整的 Cubism .model3.json 模型。');
        }
      }
      const visit = (value: unknown): void => {
        if (typeof value === 'string' && SAFE_REFERENCE_EXTENSION.test(value)) {
          if (value.includes('\\') || value.startsWith('/') || /^[a-z][a-z\d+.-]*:/iu.test(value)) {
            throw new Error('模型包含远程或不安全资源。');
          }
          const resolved = path.posix.normalize(
            path.posix.join(path.posix.dirname(relativePath), value),
          );
          if (!isSafeRelativePath(resolved)) throw new Error('模型资源越过了所选目录。');
          pending.push(resolved);
        } else if (Array.isArray(value)) {
          value.forEach(visit);
        } else if (isObject(value)) {
          Object.values(value).forEach(visit);
        }
      };
      visit(json);
    }
    if (!files.has(modelRelativePath)) throw new Error('未找到所选 Live2D 模型。');
    return files;
  }

  private async loadRegistry(): Promise<Live2DModelRegistry> {
    if (this.registry) return this.registry;
    try {
      const value = JSON.parse(await readFile(this.registryPath, 'utf8')) as unknown;
      if (!isObject(value) || value.version !== 1 || !Array.isArray(value.models))
        throw new Error();
      const models = value.models.map((item): ImportedLive2DModel => {
        if (
          !isObject(item) ||
          typeof item.modelId !== 'string' ||
          !MODEL_ID_PATTERN.test(item.modelId) ||
          typeof item.characterId !== 'string' ||
          !/^[A-Za-z0-9_-]{1,64}$/u.test(item.characterId) ||
          typeof item.modelName !== 'string' ||
          item.modelName.length < 1 ||
          item.modelName.length > 80 ||
          item.modelManifest !== 'live2d/model.json' ||
          !Array.isArray(item.assetPaths) ||
          !item.assetPaths.every(
            (assetPath) => typeof assetPath === 'string' && isSafeRelativePath(assetPath),
          )
        ) {
          throw new Error();
        }
        return item as unknown as ImportedLive2DModel;
      });
      this.registry = { version: 1, models };
      return this.registry;
    } catch (error) {
      if (!isMissingFile(error))
        throw new Error('The Live2D model registry is invalid.', { cause: error });
      this.registry = { version: 1, models: [] };
      return this.registry;
    }
  }

  private async saveRegistry(registry: Live2DModelRegistry): Promise<void> {
    await mkdir(path.dirname(this.registryPath), { recursive: true });
    const temporaryPath = `${this.registryPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    try {
      await rename(temporaryPath, this.registryPath);
      this.registry = registry;
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}
