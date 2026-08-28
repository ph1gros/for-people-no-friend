import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { CharacterPackageManifest } from '../../core/character/character-package';
import type { CharacterProfile } from '../../core/conversation/character-profile';
import type {
  CharacterLibraryEntry,
  CharacterPackagePreview,
} from '../../shared/character-package-ipc';
import type { CharacterProfileStore } from '../storage/character-profile-store';
import {
  createCharacterPackageArchive,
  inspectCharacterPackageArchive,
  type InspectedCharacterPackage,
} from './character-package-archive';

interface InstalledPackage {
  packageId: string;
  characterId: string;
  modelManifest?: string;
  assetPaths: string[];
  attribution: CharacterPackageManifest['attribution'];
}

interface PackageRegistry {
  version: 1;
  packages: InstalledPackage[];
}

interface PendingImport {
  bytes: Uint8Array;
  preview: CharacterPackagePreview;
  expiresAt: number;
}

const PREVIEW_TTL_MS = 10 * 60_000;
const PACKAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const isMissingFile = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

const compareVersions = (left: string, right: string): number => {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
};

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const sanitizeExportProfile = (profile: CharacterProfile): CharacterProfile => ({
  ...profile,
  userDisplayName: '你',
});

const safeFilePart = (value: string): string => {
  const withoutControlCharacters = Array.from(value, (character) =>
    character.codePointAt(0)! < 32 ? '-' : character,
  ).join('');
  const sanitized = withoutControlCharacters
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*]/gu, '-')
    .replace(/[. ]+$/u, '')
    .replace(/-+/gu, '-')
    .trim()
    .slice(0, 80);
  return sanitized && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(sanitized)
    ? sanitized
    : '角色';
};

export class CharacterPackageService {
  private readonly packagesRoot: string;
  private readonly registryPath: string;
  private readonly pending = new Map<string, PendingImport>();
  private registry: PackageRegistry | undefined;

  public constructor(
    userDataPath: string,
    private readonly profiles: CharacterProfileStore,
    private readonly appVersion: string,
    private readonly bundledModelRoot?: string,
  ) {
    this.packagesRoot = path.join(userDataPath, 'character-packages');
    this.registryPath = path.join(userDataPath, 'character-packages.v1.json');
  }

  public async list(): Promise<CharacterLibraryEntry[]> {
    const [profiles, active, registry] = await Promise.all([
      this.profiles.list(),
      this.profiles.get(),
      this.loadRegistry(),
    ]);
    const importedIds = new Set(registry.packages.map(({ characterId }) => characterId));
    return profiles.map((profile) => ({
      profile,
      active: profile.id === active.id,
      imported: importedIds.has(profile.id),
    }));
  }

  public async preview(bytes: Uint8Array): Promise<CharacterPackagePreview> {
    this.removeExpiredPreviews();
    const inspected = this.inspectAndValidate(bytes);
    if (compareVersions(inspected.manifest.minimumAppVersion, this.appVersion) > 0) {
      throw new Error('这个角色包需要更新版本的 For People No Friend。');
    }
    const [profiles, registry] = await Promise.all([this.profiles.list(), this.loadRegistry()]);
    const sameCharacter = profiles.find(({ id }) => id === inspected.manifest.character.id);
    const namespaceOwner = profiles.find(
      ({ memoryNamespace }) => memoryNamespace === inspected.manifest.character.memoryNamespace,
    );
    const existingPackage = registry.packages.find(
      ({ packageId }) => packageId === inspected.manifest.packageId,
    );
    const conflict =
      (namespaceOwner && namespaceOwner.id !== sameCharacter?.id) ||
      (existingPackage && existingPackage.characterId !== sameCharacter?.id)
        ? 'blocked'
        : sameCharacter || existingPackage
          ? 'replace'
          : 'none';
    const previewId = randomUUID();
    const preview: CharacterPackagePreview = {
      previewId,
      packageId: inspected.manifest.packageId,
      characterId: inspected.manifest.character.id,
      characterName: inspected.manifest.character.name,
      ...(inspected.manifest.character.lore?.sourceWork
        ? { sourceWork: inspected.manifest.character.lore.sourceWork }
        : {}),
      assetCount: inspected.files.size,
      uncompressedBytes: [...inspected.files.values()].reduce(
        (total, content) => total + content.byteLength,
        0,
      ),
      hasLive2DModel: Boolean(inspected.manifest.modelManifest),
      attribution: inspected.manifest.attribution,
      conflict,
    };
    this.pending.set(previewId, {
      bytes: Uint8Array.from(bytes),
      preview,
      expiresAt: Date.now() + PREVIEW_TTL_MS,
    });
    return preview;
  }

  public async confirmImport(
    previewId: string,
    replaceExisting: boolean,
  ): Promise<CharacterProfile> {
    this.removeExpiredPreviews();
    const pending = this.pending.get(previewId);
    this.pending.delete(previewId);
    if (!pending) throw new Error('角色包预览已过期，请重新选择文件。');
    const inspected = this.inspectAndValidate(pending.bytes);
    if (
      inspected.manifest.packageId !== pending.preview.packageId ||
      inspected.manifest.character.id !== pending.preview.characterId
    ) {
      throw new Error('角色包在确认前发生了变化。');
    }
    if (pending.preview.conflict === 'blocked') {
      throw new Error('角色 ID、包 ID 或记忆命名空间与其他角色冲突。');
    }
    if (pending.preview.conflict === 'replace' && !replaceExisting) {
      throw new Error('需要明确允许替换已有角色包。');
    }

    const packageId = inspected.manifest.packageId;
    const finalDirectory = path.join(this.packagesRoot, packageId);
    const stagingDirectory = path.join(this.packagesRoot, `.staging-${randomUUID()}`);
    const backupDirectory = path.join(this.packagesRoot, `.backup-${randomUUID()}`);
    const registry = await this.loadRegistry();
    const oldPackage = registry.packages.find(
      (item) =>
        item.packageId === packageId || item.characterId === inspected.manifest.character.id,
    );
    const oldPackageDirectory = oldPackage
      ? path.join(this.packagesRoot, oldPackage.packageId)
      : undefined;
    const oldProfile = (await this.profiles.list()).find(
      ({ id }) => id === inspected.manifest.character.id,
    );
    const profile: CharacterProfile = {
      ...inspected.manifest.character,
      live2dModelId: inspected.manifest.modelManifest ? `package-${packageId}` : 'local-model',
    };
    let movedOldDirectory = false;
    let profileChanged = false;
    try {
      await mkdir(stagingDirectory, { recursive: true });
      for (const [relativePath, content] of inspected.files) {
        const destination = path.join(stagingDirectory, ...relativePath.split('/'));
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, content, { mode: 0o600 });
      }
      if (oldPackage) {
        try {
          await rename(oldPackageDirectory!, backupDirectory);
          movedOldDirectory = true;
        } catch (error) {
          if (!isMissingFile(error)) throw error;
        }
      }
      await rename(stagingDirectory, finalDirectory);
      if (oldProfile) await this.profiles.replace(profile);
      else await this.profiles.add(profile);
      profileChanged = true;
      const next: PackageRegistry = {
        version: 1,
        packages: [
          ...registry.packages.filter(
            (item) => item.packageId !== packageId && item.characterId !== profile.id,
          ),
          {
            packageId,
            characterId: profile.id,
            ...(inspected.manifest.modelManifest
              ? { modelManifest: inspected.manifest.modelManifest }
              : {}),
            assetPaths: inspected.manifest.assets.map(({ path }) => path),
            attribution: inspected.manifest.attribution,
          },
        ],
      };
      await this.saveRegistry(next);
      await this.profiles.activate(profile.id);
      if (movedOldDirectory) await rm(backupDirectory, { recursive: true, force: true });
      return profile;
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true });
      await rm(finalDirectory, { recursive: true, force: true });
      if (movedOldDirectory && oldPackageDirectory) {
        await rename(backupDirectory, oldPackageDirectory).catch(() => undefined);
      }
      if (profileChanged) {
        if (oldProfile) await this.profiles.replace(oldProfile).catch(() => undefined);
        else await this.profiles.remove(profile.id).catch(() => undefined);
      }
      throw error;
    }
  }

  public async activate(characterId: string): Promise<CharacterProfile> {
    return this.profiles.activate(characterId);
  }

  public async remove(characterId: string): Promise<void> {
    const registry = await this.loadRegistry();
    const installed = registry.packages.find((item) => item.characterId === characterId);
    if (!installed) throw new Error('内置或手动创建的角色不能从角色包库删除。');
    await this.profiles.remove(characterId);
    await this.saveRegistry({
      version: 1,
      packages: registry.packages.filter((item) => item.characterId !== characterId),
    });
    await rm(path.join(this.packagesRoot, installed.packageId), { recursive: true, force: true });
  }

  public async exportActive(): Promise<{ fileName: string; bytes: Uint8Array }> {
    const [profile, registry] = await Promise.all([this.profiles.get(), this.loadRegistry()]);
    const installed = registry.packages.find((item) => item.characterId === profile.id);
    let files = new Map<string, Uint8Array>();
    let modelManifest = installed?.modelManifest;
    let bundledAttribution: CharacterPackageManifest['attribution'] = [];
    if (installed) {
      const packageDirectory = path.join(this.packagesRoot, installed.packageId);
      for (const relativePath of installed.assetPaths) {
        files.set(
          relativePath,
          new Uint8Array(await readFile(path.join(packageDirectory, ...relativePath.split('/')))),
        );
      }
    } else if (profile.live2dModelId === 'local-model' && this.bundledModelRoot) {
      const bundled = await this.collectBundledModelFiles();
      files = bundled.files;
      modelManifest = bundled.modelManifest;
      bundledAttribution = bundled.attribution;
    }
    const packageId = installed?.packageId ?? `character-${profile.id}`;
    const manifest: CharacterPackageManifest = {
      version: 1,
      packageId,
      character: sanitizeExportProfile(profile),
      ...(modelManifest ? { modelManifest } : {}),
      assets: [...files].map(([assetPath, content]) => ({
        path: assetPath,
        sha256: sha256(content),
      })),
      attribution: [
        ...(installed?.attribution ??
          (profile.lore?.sources ?? []).map((source) => ({
            title: source.title,
            url: source.url,
            licenseNote: '角色资料来源；素材许可需由导出者另行确认。',
          }))),
        ...bundledAttribution,
      ],
      minimumAppVersion: '1.4.0',
    };
    const exportName = [profile.name, profile.lore?.sourceWork]
      .filter((value): value is string => Boolean(value?.trim()))
      .map(safeFilePart)
      .join('-');
    return {
      fileName: `${exportName}.fpnf-character.zip`,
      bytes: createCharacterPackageArchive(manifest, files),
    };
  }

  public async resolveActiveAsset(relativePath: string): Promise<string | undefined> {
    if (!relativePath || relativePath.includes('\\') || relativePath.split('/').includes('..')) {
      return undefined;
    }
    const [profile, registry] = await Promise.all([this.profiles.get(), this.loadRegistry()]);
    const installed = registry.packages.find((item) => item.characterId === profile.id);
    if (!installed?.modelManifest || !installed.assetPaths.includes(relativePath)) return undefined;
    return path.join(this.packagesRoot, installed.packageId, ...relativePath.split('/'));
  }

  public async getActiveModelManifest(): Promise<string | undefined> {
    const [profile, registry] = await Promise.all([this.profiles.get(), this.loadRegistry()]);
    return registry.packages.find((item) => item.characterId === profile.id)?.modelManifest;
  }

  private removeExpiredPreviews(): void {
    const now = Date.now();
    for (const [id, pending] of this.pending) {
      if (pending.expiresAt <= now) this.pending.delete(id);
    }
  }

  private async collectBundledModelFiles(): Promise<{
    files: Map<string, Uint8Array>;
    modelManifest: string;
    attribution: CharacterPackageManifest['attribution'];
  }> {
    const root = this.bundledModelRoot!;
    const pending = ['model.json'];
    const visited = new Set<string>();
    const files = new Map<string, Uint8Array>();
    const referencedExtensions = /\.(?:json|moc3|png|jpe?g|webp|wav|mp3)$/iu;
    while (pending.length > 0) {
      const relativePath = pending.shift()!;
      if (visited.has(relativePath)) continue;
      visited.add(relativePath);
      const content = new Uint8Array(await readFile(path.join(root, ...relativePath.split('/'))));
      files.set(`live2d/${relativePath}`, content);
      if (!relativePath.toLowerCase().endsWith('.json')) continue;
      const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)) as unknown;
      const visit = (value: unknown): void => {
        if (typeof value === 'string') {
          if (value.toLowerCase().endsWith('.js') || !referencedExtensions.test(value)) return;
          if (value.includes('\\') || value.startsWith('/') || /^[a-z][a-z\d+.-]*:/iu.test(value)) {
            throw new Error('The bundled Live2D model contains an unsafe resource path.');
          }
          const resolved = path.posix.normalize(
            path.posix.join(path.posix.dirname(relativePath), value),
          );
          if (resolved === '..' || resolved.startsWith('../')) {
            throw new Error('The bundled Live2D model escapes its asset directory.');
          }
          pending.push(resolved);
        } else if (Array.isArray(value)) {
          value.forEach(visit);
        } else if (value && typeof value === 'object') {
          Object.values(value as Record<string, unknown>).forEach(visit);
        }
      };
      visit(json);
    }
    const modelPath = [...visited].find((item) => item.toLowerCase().endsWith('.model3.json'));
    if (modelPath) {
      const candidate = path.posix.join(path.posix.dirname(modelPath), 'ATTRIBUTION.md');
      try {
        files.set(
          `live2d/${candidate}`,
          new Uint8Array(await readFile(path.join(root, ...candidate.split('/')))),
        );
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }
    const hasKaltsitAttribution = [...files.keys()].some((item) =>
      item.toLowerCase().endsWith('kaltsit-work/attribution.md'),
    );
    return {
      files,
      modelManifest: 'live2d/model.json',
      attribution: hasKaltsitAttribution
        ? [
            {
              title: '“工作凯尔希”Live2D 模型，作者：什行在要',
              url: 'https://www.bilibili.com/video/BV1Le411976u/',
              licenseNote:
                '项目已获作者允许收录与分发；仅限非盈利使用，完整说明见包内 ATTRIBUTION.md。',
            },
          ]
        : [],
    };
  }

  private inspectAndValidate(bytes: Uint8Array): InspectedCharacterPackage {
    const inspected = inspectCharacterPackageArchive(bytes);
    const modelManifest = inspected.manifest.modelManifest;
    if (!modelManifest) return inspected;
    const manifestBytes = inspected.files.get(modelManifest);
    if (!manifestBytes) throw new Error('角色包的 Live2D 清单不存在。');
    let control: unknown;
    try {
      control = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
    } catch {
      throw new Error('角色包的 Live2D 清单不是有效 JSON。');
    }
    if (!control || typeof control !== 'object' || Array.isArray(control)) {
      throw new Error('角色包的 Live2D 清单无效。');
    }
    const record = control as Record<string, unknown>;
    if (
      record.version !== 1 ||
      typeof record.core !== 'string' ||
      path.posix.basename(record.core).toLowerCase() !== 'live2dcubismcore.min.js' ||
      typeof record.model !== 'string' ||
      !record.model.toLowerCase().endsWith('.model3.json') ||
      !record.controls ||
      typeof record.controls !== 'object'
    ) {
      throw new Error('角色包的 Live2D 清单无效。');
    }
    const resolveReference = (owner: string, reference: string): string => {
      if (
        reference.includes('\\') ||
        reference.startsWith('/') ||
        /^[a-z][a-z\d+.-]*:/iu.test(reference)
      ) {
        throw new Error('角色包的模型包含远程或不安全资源。');
      }
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(owner), reference));
      if (resolved === '..' || resolved.startsWith('../')) {
        throw new Error('角色包的模型资源越过了包目录。');
      }
      return resolved;
    };
    const modelPath = resolveReference(modelManifest, record.model);
    if (!inspected.files.has(modelPath)) throw new Error('角色包缺少声明的 Live2D 模型。');
    const referencedExtensions = /\.(?:json|moc3|png|jpe?g|webp|wav|mp3)$/iu;
    for (const [assetPath, content] of inspected.files) {
      if (!assetPath.toLowerCase().endsWith('.json')) continue;
      let json: unknown;
      try {
        json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content));
      } catch {
        throw new Error('角色包包含无效 JSON 资源。');
      }
      const visit = (value: unknown): void => {
        if (typeof value === 'string') {
          if (/^[a-z][a-z\d+.-]*:/iu.test(value)) {
            throw new Error('角色包的模型包含远程资源。');
          }
          if (referencedExtensions.test(value)) {
            const referenced = resolveReference(assetPath, value);
            if (!inspected.files.has(referenced)) {
              throw new Error('角色包引用了未声明的模型资源。');
            }
          }
        } else if (Array.isArray(value)) {
          value.forEach(visit);
        } else if (value && typeof value === 'object') {
          Object.values(value as Record<string, unknown>).forEach(visit);
        }
      };
      visit(json);
    }
    return inspected;
  }

  private async loadRegistry(): Promise<PackageRegistry> {
    if (this.registry) return this.registry;
    try {
      const value = JSON.parse(await readFile(this.registryPath, 'utf8')) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      const record = value as Record<string, unknown>;
      if (record.version !== 1 || !Array.isArray(record.packages)) throw new Error();
      const packages = record.packages.map((item): InstalledPackage => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error();
        const entry = item as Record<string, unknown>;
        if (
          typeof entry.packageId !== 'string' ||
          !PACKAGE_ID_PATTERN.test(entry.packageId) ||
          typeof entry.characterId !== 'string' ||
          !PACKAGE_ID_PATTERN.test(entry.characterId) ||
          (entry.modelManifest !== undefined && typeof entry.modelManifest !== 'string') ||
          !Array.isArray(entry.assetPaths) ||
          !entry.assetPaths.every(
            (assetPath) =>
              typeof assetPath === 'string' &&
              assetPath.length > 0 &&
              !assetPath.includes('\\') &&
              !assetPath.split('/').includes('..'),
          ) ||
          !Array.isArray(entry.attribution)
        ) {
          throw new Error();
        }
        return entry as unknown as InstalledPackage;
      });
      this.registry = { version: 1, packages };
      return this.registry;
    } catch (error) {
      if (!isMissingFile(error)) {
        throw new Error('The character package registry is invalid.', { cause: error });
      }
      this.registry = { version: 1, packages: [] };
      return this.registry;
    }
  }

  private async saveRegistry(registry: PackageRegistry): Promise<void> {
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
