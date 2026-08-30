import { constants as fsConstants } from 'node:fs';
import { access, copyFile, lstat, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { VTubeStudioOperationResult } from '../../shared/vtube-studio-ipc';

const MAX_FILES = 200;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  '.json',
  '.moc3',
  '.model3.json',
  '.physics3.json',
  '.motion3.json',
  '.exp3.json',
  '.vtube.json',
  '.png',
  '.jpg',
  '.jpeg',
]);

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const modelExtension = (name: string): string => {
  const lower = name.toLowerCase();
  for (const compound of [
    '.model3.json',
    '.physics3.json',
    '.motion3.json',
    '.exp3.json',
    '.vtube.json',
  ]) {
    if (lower.endsWith(compound)) return compound;
  }
  return path.extname(lower);
};

const existingDirectory = async (candidate: string): Promise<string | undefined> => {
  try {
    const stats = await lstat(candidate);
    if (!stats.isDirectory() || stats.isSymbolicLink()) return undefined;
    return realpath(candidate);
  } catch {
    return undefined;
  }
};

const readSteamLibraries = async (steamRoot: string): Promise<string[]> => {
  const roots = [steamRoot];
  try {
    const value = await readFile(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const match of value.matchAll(/"path"\s+"([^"]+)"/giu)) {
      const candidate = match[1]?.replaceAll('\\\\', '\\').trim();
      if (candidate) roots.push(candidate);
    }
  } catch {
    // The default Steam library remains a valid fallback.
  }
  return [...new Set(roots)];
};

export class BundledVTubeModelInstaller {
  public constructor(
    private readonly sourceRoot: string,
    private readonly steamRootCandidates: readonly string[],
  ) {}

  public async install(): Promise<VTubeStudioOperationResult> {
    try {
      const sourceRoot = await existingDirectory(this.sourceRoot);
      if (!sourceRoot || !(await this.containsModelManifest(sourceRoot))) {
        return { ok: false, message: '安装包中没有可再分发的 VTube Studio 模型。' };
      }
      const destinationParent = await this.findVTubeModelDirectory();
      if (!destinationParent) {
        return { ok: false, message: '没有找到 VTube Studio；请先通过 Steam 安装并启动一次。' };
      }
      const destinationRoot = path.join(destinationParent, 'FPNF-Kitten');
      await mkdir(destinationRoot, { recursive: true });
      const canonicalDestination = await realpath(destinationRoot);
      let fileCount = 0;
      let totalBytes = 0;
      const copyDirectory = async (source: string, destination: string): Promise<void> => {
        for (const entry of await readdir(source, { withFileTypes: true })) {
          const sourcePath = path.join(source, entry.name);
          const stats = await lstat(sourcePath);
          const canonicalSource = await realpath(sourcePath);
          if (stats.isSymbolicLink() || !isWithin(sourceRoot, canonicalSource)) {
            throw new Error('Bundled model contains a symbolic link or escaped path.');
          }
          const destinationPath = path.join(destination, entry.name);
          if (entry.isDirectory()) {
            await mkdir(destinationPath, { recursive: true });
            const canonicalChild = await realpath(destinationPath);
            if (!isWithin(canonicalDestination, canonicalChild))
              throw new Error('Invalid destination.');
            await copyDirectory(canonicalSource, canonicalChild);
            continue;
          }
          if (!entry.isFile() || !ALLOWED_EXTENSIONS.has(modelExtension(entry.name))) {
            continue;
          }
          fileCount += 1;
          totalBytes += stats.size;
          if (fileCount > MAX_FILES || totalBytes > MAX_TOTAL_BYTES) {
            throw new Error('Bundled model exceeds the allowed package bounds.');
          }
          await copyFile(canonicalSource, destinationPath);
        }
      };
      await copyDirectory(sourceRoot, canonicalDestination);
      return {
        ok: true,
        message: `已安装 VTube Studio 模型（${fileCount} 个文件）；请重启 VTube Studio 后选择 FPNF-Kitten。`,
      };
    } catch {
      return { ok: false, message: 'VTube Studio 模型安装失败；没有修改程序设置。' };
    }
  }

  private async containsModelManifest(root: string): Promise<boolean> {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.model3.json')) return true;
      if (entry.isDirectory() && (await this.containsModelManifest(path.join(root, entry.name)))) {
        return true;
      }
    }
    return false;
  }

  private async findVTubeModelDirectory(): Promise<string | undefined> {
    for (const candidate of this.steamRootCandidates) {
      const steamRoot = await existingDirectory(candidate);
      if (!steamRoot) continue;
      for (const library of await readSteamLibraries(steamRoot)) {
        const modelDirectory = path.join(
          library,
          'steamapps',
          'common',
          'VTube Studio',
          'VTube Studio_Data',
          'StreamingAssets',
          'Live2DModels',
        );
        try {
          await access(modelDirectory, fsConstants.W_OK);
          const canonical = await existingDirectory(modelDirectory);
          if (canonical) return canonical;
        } catch {
          // Try the next configured Steam library.
        }
      }
    }
    return undefined;
  }
}
