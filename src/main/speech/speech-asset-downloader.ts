import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { Unzip, UnzipInflate, UnzipPassThrough, type UnzipFile } from 'fflate';

import { SPEECH_ASSET_TIER_IDS, type SpeechAssetTierId } from '../../shared/speech-asset-ipc';
import { isSpeechAssetActivated } from './speech-asset-activation';
import { SPEECH_ASSET_INTEGRITY, type SpeechAssetIntegrity } from './speech-asset-integrity';

const MANIFEST_MAX_BYTES = 256 * 1024;
const ARCHIVE_MAX_BYTES = 1_500 * 1024 * 1024;
const UNCOMPRESSED_MAX_BYTES = 3_000 * 1024 * 1024;
const ARCHIVE_MAX_ENTRIES = 25_000;
const SEGMENTED_DOWNLOAD_MIN_BYTES = 1024 * 1024;
const TIER_IDS = SPEECH_ASSET_TIER_IDS;
const REQUIRED_TARGET_FILES: Readonly<Record<SpeechAssetTarget, readonly string[]>> = {
  'voice-runtime': [
    'python/python.exe',
    'ireina_tts_service.py',
    'python/Lib/site-packages/bert/deberta-v2-large-japanese-char-wwm-onnx/model_fp16.onnx',
    'python/Lib/site-packages/bert/deberta-v2-large-japanese-char-wwm-onnx/config.json',
    'python/Lib/site-packages/bert/deberta-v2-large-japanese-char-wwm-onnx/tokenizer.json',
    'voice/ireina/ireina_e100_s16040.onnx',
    'voice/ireina/config.json',
    'voice/ireina/style_vectors.npy',
  ],
  'speech-input-runtime': ['models/sensevoice/model.int8.onnx', 'models/sensevoice/tokens.txt'],
};

export type { SpeechAssetTierId } from '../../shared/speech-asset-ipc';
export type SpeechAssetTarget = SpeechAssetIntegrity['target'];

export interface SpeechAssetTier {
  id: SpeechAssetTierId;
  version: string;
  target: SpeechAssetTarget;
  bytes: number;
  sha256: string;
  extractedBytes: number;
  maxEntries: number;
  urls: string[];
}

export interface SpeechAssetManifest {
  schemaVersion: 2;
  tiers: SpeechAssetTier[];
}

export interface SpeechAssetNetworkPolicy {
  allowLocalhostHttp?: boolean;
}

export interface SpeechAssetInstallStatus {
  id: SpeechAssetTierId;
  state: 'ready' | 'paused';
  downloadedBytes: number;
  totalBytes: number;
}

export interface SpeechAssetDownloaderOptions extends SpeechAssetNetworkPolicy {
  fetch?: typeof fetch;
  segmentCount?: number;
  onProgress?: (status: {
    id: SpeechAssetTierId;
    downloadedBytes: number;
    totalBytes: number;
  }) => void;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index])
  );
};

const parseDownloadUrl = (value: unknown, policy: SpeechAssetNetworkPolicy): string => {
  if (typeof value !== 'string' || value.length > 2_048) {
    throw new Error('语音资产清单包含无效下载地址。');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('语音资产清单包含无效下载地址。');
  }
  const localHttp =
    policy.allowLocalhostHttp === true &&
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]');
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error('语音资产下载地址必须使用 HTTPS。');
  }
  if (url.username || url.password || url.hash) {
    throw new Error('语音资产下载地址不能包含凭据或片段。');
  }
  return url.toString();
};

const parseTier = (
  value: unknown,
  policy: SpeechAssetNetworkPolicy,
): SpeechAssetTier | undefined => {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ['id', 'version', 'urls']) ||
    !TIER_IDS.includes(value.id as SpeechAssetTierId) ||
    typeof value.version !== 'string' ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/u.test(value.version) ||
    !Array.isArray(value.urls) ||
    value.urls.length === 0 ||
    value.urls.length > 4
  ) {
    throw new Error('语音资产清单的档位格式无效。');
  }
  const id = value.id as SpeechAssetTierId;
  const urls = value.urls.map((url) => parseDownloadUrl(url, policy));
  if (new Set(urls).size !== urls.length) throw new Error('语音资产清单包含重复下载地址。');
  const integrity = SPEECH_ASSET_INTEGRITY[id];
  if (!integrity || value.version !== integrity.version) return undefined;
  if (
    !/^[a-f0-9]{64}$/u.test(integrity.sha256) ||
    !Number.isSafeInteger(integrity.compressedBytes) ||
    integrity.compressedBytes <= 0 ||
    integrity.compressedBytes > ARCHIVE_MAX_BYTES ||
    !Number.isSafeInteger(integrity.extractedBytes) ||
    integrity.extractedBytes <= 0 ||
    integrity.extractedBytes > UNCOMPRESSED_MAX_BYTES ||
    !Number.isSafeInteger(integrity.maxEntries) ||
    integrity.maxEntries <= 0 ||
    integrity.maxEntries > ARCHIVE_MAX_ENTRIES ||
    integrity.target !== (id === 'speech-input' ? 'speech-input-runtime' : 'voice-runtime')
  )
    throw new Error('应用内置语音资产校验记录无效，该档位不可用。');
  return {
    id,
    version: integrity.version,
    target: integrity.target,
    bytes: integrity.compressedBytes,
    sha256: integrity.sha256,
    extractedBytes: integrity.extractedBytes,
    maxEntries: integrity.maxEntries,
    urls,
  };
};

export const parseSpeechAssetManifest = (
  value: unknown,
  policy: SpeechAssetNetworkPolicy = {},
): SpeechAssetManifest => {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ['schemaVersion', 'tiers']) ||
    value.schemaVersion !== 2 ||
    !Array.isArray(value.tiers) ||
    value.tiers.length === 0 ||
    value.tiers.length > TIER_IDS.length
  ) {
    throw new Error('语音资产清单格式无效。');
  }
  const parsed = value.tiers.map((tier) => parseTier(tier, policy));
  const ids = value.tiers.map((tier: Record<string, unknown>) => tier.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('语音资产清单包含重复档位。');
  }
  return { schemaVersion: 2, tiers: parsed.filter((tier) => tier !== undefined) };
};

export const fetchSpeechAssetManifest = async (
  manifestUrl: string,
  options: SpeechAssetNetworkPolicy & { fetch?: typeof fetch } = {},
): Promise<SpeechAssetManifest> => {
  const url = parseDownloadUrl(manifestUrl, options);
  const response = await (options.fetch ?? fetch)(url, {
    headers: { accept: 'application/json' },
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`语音资产清单读取失败（HTTP ${response.status}）。`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MANIFEST_MAX_BYTES) {
    throw new Error('语音资产清单过大。');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MANIFEST_MAX_BYTES) throw new Error('语音资产清单过大。');
  try {
    return parseSpeechAssetManifest(JSON.parse(text) as unknown, options);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('语音资产清单不是有效 JSON。', { cause: error });
    }
    throw error;
  }
};

const sha256File = async (filePath: string): Promise<string> =>
  await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });

const safeArchivePath = (value: string): string => {
  if (
    value.length === 0 ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/u.test(value) ||
    value.split('/').includes('..')
  ) {
    throw new Error('语音资产压缩包包含不安全路径。');
  }
  const normalized = path.posix.normalize(value).replace(/\/$/u, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../')) {
    throw new Error('语音资产压缩包包含不安全路径。');
  }
  return normalized;
};

const writeArchiveToStaging = async (
  archivePath: string,
  stagingRoot: string,
  limits: Pick<SpeechAssetTier, 'maxEntries' | 'extractedBytes'>,
): Promise<void> => {
  const tasks: Promise<void>[] = [];
  const destinations = new Set<string>();
  let entryCount = 0;
  let totalBytes = 0;
  let streamError: unknown;
  const extractFile = (file: UnzipFile): Promise<void> =>
    (async () => {
      entryCount += 1;
      if (entryCount > limits.maxEntries) throw new Error('语音资产压缩包文件数量无效。');
      const relativePath = safeArchivePath(file.name);
      if (destinations.has(relativePath)) throw new Error('语音资产压缩包包含重复路径。');
      destinations.add(relativePath);
      const destination = path.join(stagingRoot, ...relativePath.split('/'));
      if (file.name.endsWith('/')) {
        await mkdir(destination, { recursive: true });
        file.ondata = (error) => {
          if (error) streamError = error;
        };
        file.start();
        return;
      }
      await mkdir(path.dirname(destination), { recursive: true });
      const handle = await open(destination, 'w', 0o600);
      await new Promise<void>((resolve, reject) => {
        let writes = Promise.resolve();
        let settled = false;
        const fail = (error: unknown): void => {
          if (settled) return;
          settled = true;
          file.terminate();
          void handle.close().finally(() => reject(error));
        };
        file.ondata = (error, chunk, final) => {
          if (error) {
            fail(error);
            return;
          }
          writes = writes.then(async () => {
            totalBytes += chunk.byteLength;
            if (totalBytes > limits.extractedBytes) {
              throw new Error('语音资产解压后体积过大。');
            }
            await handle.write(chunk);
            if (final && !settled) {
              await handle.sync();
              await handle.close();
              settled = true;
              resolve();
            }
          });
          void writes.catch(fail);
        };
        try {
          file.start();
        } catch (error) {
          fail(error);
        }
      });
    })();
  const unzip = new Unzip((file) => {
    const task = extractFile(file);
    void task.catch(() => undefined);
    tasks.push(task);
  });
  unzip.register(UnzipPassThrough);
  unzip.register(UnzipInflate);
  try {
    for await (const chunk of createReadStream(archivePath)) {
      unzip.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    }
    unzip.push(new Uint8Array(), true);
  } catch (error) {
    streamError = error;
  }
  const results = await Promise.allSettled(tasks);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  if (streamError) throw streamError;
  if (entryCount === 0) throw new Error('语音资产压缩包文件数量无效。');
};

/**
 * Reclaim owned staging trees and redundant backups before any new installation starts.
 *
 * activate() unwinds these on failure, but a terminated process never runs that path, and each
 * attempt uses a fresh UUID, so orphans accumulate instead of being overwritten. One abandoned
 * staging tree can hold the entire extracted archive. In-progress downloads under `.downloads`
 * are deliberately preserved so a resumed transfer does not restart from zero.
 */
export const cleanupOrphanedSpeechAssetWorkspaces = async (
  speechAssetsRoot: string,
): Promise<number> => {
  const rootDetails = await lstat(speechAssetsRoot).catch(() => undefined);
  if (!rootDetails?.isDirectory() || rootDetails.isSymbolicLink()) return 0;
  const root = await realpath(speechAssetsRoot);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => undefined);
  if (!entries) return 0;
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  const stagingName = new RegExp(`^\\.staging-(voice-runtime|speech-input)-${uuid}$`, 'u');
  const backupName = new RegExp(`^\\.backup-(voice-runtime|speech-input-runtime)-${uuid}$`, 'u');
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const backup = backupName.exec(entry.name);
    if (!stagingName.test(entry.name) && !backup) continue;
    const candidate = path.resolve(root, entry.name);
    if (path.dirname(candidate) !== root) continue;
    const details = await lstat(candidate).catch(() => undefined);
    if (!details?.isDirectory() || details.isSymbolicLink()) continue;
    if (backup) {
      // A kill between the two renames can leave the backup as the only surviving copy.
      // Keep it unless the replacement is complete and authorized by the current app.
      const target = backup[1] as SpeechAssetTarget;
      const id = target === 'voice-runtime' ? 'voice-runtime' : 'speech-input';
      if (!(await isSpeechAssetActivated(root, id))) continue;
      const valid = await validateInstalledSpeechAssetTarget(path.join(root, target), target).then(
        () => true,
        () => false,
      );
      if (!valid) continue;
    }
    const deleted = await rm(candidate, { recursive: true, force: true }).then(
      () => true,
      () => false,
    );
    if (deleted) removed += 1;
  }
  return removed;
};

export const validateInstalledSpeechAssetTarget = async (
  targetRoot: string,
  target: SpeechAssetTarget,
): Promise<void> => {
  const rootDetails = await lstat(targetRoot).catch(() => undefined);
  if (!rootDetails?.isDirectory() || rootDetails.isSymbolicLink()) {
    throw new Error('语音资产安装目录无效。');
  }
  const resolvedRoot = await realpath(targetRoot);
  for (const relativePath of REQUIRED_TARGET_FILES[target]) {
    const candidate = path.join(targetRoot, ...relativePath.split('/'));
    const details = await lstat(candidate).catch(() => undefined);
    if (!details?.isFile() || details.isSymbolicLink()) {
      throw new Error(`语音资产缺少启用所需文件：${relativePath}`);
    }
    const resolvedCandidate = await realpath(candidate);
    const relativeCandidate = path.relative(resolvedRoot, resolvedCandidate);
    if (
      relativeCandidate === '' ||
      relativeCandidate === '..' ||
      relativeCandidate.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeCandidate)
    ) {
      throw new Error(`语音资产文件越过安装目录：${relativePath}`);
    }
  }
};

export class SpeechAssetDownloader {
  private readonly active = new Map<SpeechAssetTierId, AbortController>();
  private readonly activeTargets = new Set<SpeechAssetTarget>();
  private readonly paused = new Set<SpeechAssetTierId>();
  private readonly fetcher: typeof fetch;

  public constructor(
    private readonly speechAssetsRoot: string,
    private readonly options: SpeechAssetDownloaderOptions = {},
  ) {
    this.fetcher = options.fetch ?? fetch;
  }

  public pause(id: SpeechAssetTierId): void {
    this.paused.add(id);
    this.active.get(id)?.abort();
  }

  public async cancel(id: SpeechAssetTierId, version: string): Promise<void> {
    this.paused.delete(id);
    this.active.get(id)?.abort();
    await rm(this.partialPath(id, version), { force: true });
    await rm(this.segmentRoot(id, version), { recursive: true, force: true });
  }

  public async install(request: SpeechAssetTier): Promise<SpeechAssetInstallStatus> {
    // Re-resolve at the installation boundary; caller-supplied hashes, sizes and paths
    // are never authorization to install or execute downloaded content.
    const tier = parseTier(
      { id: request.id, version: request.version, urls: request.urls },
      this.options,
    );
    if (!tier) throw new Error('此语音资产没有匹配的应用内置校验记录，暂不可下载。');
    if (this.active.has(tier.id) || this.activeTargets.has(tier.target)) {
      throw new Error('这个语音资产档位正在下载或安装。');
    }
    this.paused.delete(tier.id);
    const controller = new AbortController();
    this.active.set(tier.id, controller);
    this.activeTargets.add(tier.target);
    try {
      await mkdir(this.speechAssetsRoot, { recursive: true });
      const disk = await statfs(this.speechAssetsRoot).catch(() => {
        throw new Error('无法确认可用磁盘空间，语音资产下载已停止。');
      });
      const requiredBytes = Math.ceil(tier.extractedBytes * 1.3) + tier.bytes + 500 * 1024 * 1024;
      if (disk.bavail * disk.bsize < requiredBytes) {
        throw new Error('磁盘空间不足，请释放空间后再下载语音资产。');
      }
      controller.signal.throwIfAborted();
      const partialPath = await this.download(tier, controller.signal);
      controller.signal.throwIfAborted();
      const actualHash = await sha256File(partialPath);
      controller.signal.throwIfAborted();
      if (actualHash !== tier.sha256) {
        await rm(partialPath, { force: true });
        throw new Error('语音资产 SHA256 校验失败，损坏文件已删除。');
      }
      await this.activate(tier, partialPath);
      await rm(partialPath, { force: true });
      return { id: tier.id, state: 'ready', downloadedBytes: tier.bytes, totalBytes: tier.bytes };
    } catch (error) {
      if (controller.signal.aborted && this.paused.has(tier.id)) {
        return {
          id: tier.id,
          state: 'paused',
          downloadedBytes: await this.partialSize(tier),
          totalBytes: tier.bytes,
        };
      }
      throw error;
    } finally {
      this.active.delete(tier.id);
      this.activeTargets.delete(tier.target);
    }
  }

  private partialPath(id: SpeechAssetTierId, version: string): string {
    return path.join(this.speechAssetsRoot, '.downloads', `${id}-${version}.zip.part`);
  }

  private segmentRoot(id: SpeechAssetTierId, version: string): string {
    return path.join(this.speechAssetsRoot, '.downloads', `${id}-${version}.parts`);
  }

  private async partialSize(tier: SpeechAssetTier): Promise<number> {
    const legacySize = (await stat(this.partialPath(tier.id, tier.version)).catch(() => undefined))
      ?.size;
    if (legacySize !== undefined) return legacySize;
    const segmentCount = this.segmentCount(tier);
    if (segmentCount === 1) return 0;
    const sizes = await Promise.all(
      Array.from(
        { length: segmentCount },
        async (_unused, index) =>
          (
            await stat(path.join(this.segmentRoot(tier.id, tier.version), `${index}.part`)).catch(
              () => undefined,
            )
          )?.size ?? 0,
      ),
    );
    return sizes.reduce((total, size) => total + size, 0);
  }

  private async download(tier: SpeechAssetTier, signal: AbortSignal): Promise<string> {
    const legacyPartial = await stat(this.partialPath(tier.id, tier.version)).catch(
      () => undefined,
    );
    if (this.segmentCount(tier) > 1 && !legacyPartial) {
      return this.downloadSegmented(tier, signal);
    }
    return this.downloadSequential(tier, signal);
  }

  private segmentCount(tier: SpeechAssetTier): number {
    if (tier.bytes < SEGMENTED_DOWNLOAD_MIN_BYTES) return 1;
    const configured = this.options.segmentCount ?? 4;
    return Math.max(1, Math.min(8, Math.trunc(configured)));
  }

  private async downloadSequential(tier: SpeechAssetTier, signal: AbortSignal): Promise<string> {
    const partialPath = this.partialPath(tier.id, tier.version);
    await mkdir(path.dirname(partialPath), { recursive: true });
    let lastError: unknown;
    for (const source of tier.urls) {
      try {
        let offset = await this.partialSize(tier);
        if (offset > tier.bytes) {
          await rm(partialPath, { force: true });
          offset = 0;
        }
        const response = await this.fetcher(source, {
          headers: offset > 0 ? { range: `bytes=${offset}-` } : {},
          redirect: 'error',
          signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`语音资产下载失败（HTTP ${response.status}）。`);
        }
        if (offset > 0) {
          const contentRange = response.headers.get('content-range');
          if (response.status === 200) {
            await response.body.cancel();
            await rm(partialPath, { force: true });
            return await this.download(tier, signal);
          }
          if (
            response.status !== 206 ||
            contentRange !== `bytes ${offset}-${tier.bytes - 1}/${tier.bytes}`
          ) {
            await response.body.cancel();
            throw new Error('语音资产服务器返回了无效的分段响应。');
          }
        } else if (response.status !== 200) {
          await response.body.cancel();
          throw new Error('语音资产服务器返回了无效的分段响应。');
        }
        const contentLength = response.headers.get('content-length');
        if (contentLength !== null && Number(contentLength) !== tier.bytes - offset) {
          await response.body.cancel();
          throw new Error('语音资产响应体积与应用内置记录不一致。');
        }
        const handle = await open(partialPath, offset > 0 ? 'a' : 'w');
        let downloaded = offset;
        try {
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            downloaded += value.byteLength;
            if (downloaded > tier.bytes) throw new Error('语音资产下载体积超过应用内置记录。');
            await handle.write(value);
            this.options.onProgress?.({
              id: tier.id,
              downloadedBytes: downloaded,
              totalBytes: tier.bytes,
            });
          }
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (downloaded !== tier.bytes) throw new Error('语音资产下载未完成，可稍后继续。');
        return partialPath;
      } catch (error) {
        if (signal.aborted) throw error;
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('所有语音资产下载源都不可用。');
  }

  private async downloadSegmented(tier: SpeechAssetTier, signal: AbortSignal): Promise<string> {
    const segmentCount = this.segmentCount(tier);
    const segmentRoot = this.segmentRoot(tier.id, tier.version);
    await mkdir(segmentRoot, { recursive: true });
    const segmentSizes = new Array<number>(segmentCount).fill(0);
    await Promise.all(
      Array.from({ length: segmentCount }, async (_unused, index) => {
        const start = Math.floor((tier.bytes * index) / segmentCount);
        const end = Math.floor((tier.bytes * (index + 1)) / segmentCount) - 1;
        const segmentPath = path.join(segmentRoot, `${index}.part`);
        const expectedBytes = end - start + 1;
        let existingBytes = (await stat(segmentPath).catch(() => undefined))?.size ?? 0;
        if (existingBytes > expectedBytes) {
          await rm(segmentPath, { force: true });
          existingBytes = 0;
        }
        segmentSizes[index] = existingBytes;
        if (existingBytes === expectedBytes) return;
        let lastError: unknown;
        for (const source of tier.urls) {
          try {
            const rangeStart = start + existingBytes;
            const response = await this.fetcher(source, {
              headers: { range: `bytes=${rangeStart}-${end}` },
              redirect: 'error',
              signal,
            });
            const expectedRange = `bytes ${rangeStart}-${end}/${tier.bytes}`;
            if (
              response.status !== 206 ||
              !response.body ||
              response.headers.get('content-range') !== expectedRange ||
              (response.headers.has('content-length') &&
                Number(response.headers.get('content-length')) !== end - rangeStart + 1)
            ) {
              await response.body?.cancel();
              throw new Error('语音资产服务器不支持安全的分段下载。');
            }
            const handle = await open(segmentPath, existingBytes > 0 ? 'a' : 'w');
            let downloaded = existingBytes;
            try {
              const reader = response.body.getReader();
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                downloaded += value.byteLength;
                if (downloaded > expectedBytes) {
                  throw new Error('语音资产分段体积超过应用内置记录。');
                }
                await handle.write(value);
                segmentSizes[index] = downloaded;
                this.options.onProgress?.({
                  id: tier.id,
                  downloadedBytes: segmentSizes.reduce((total, size) => total + size, 0),
                  totalBytes: tier.bytes,
                });
              }
              await handle.sync();
            } finally {
              await handle.close();
            }
            if (downloaded !== expectedBytes) {
              throw new Error('语音资产分段下载未完成，可稍后继续。');
            }
            return;
          } catch (error) {
            if (signal.aborted) throw error;
            lastError = error;
            existingBytes = (await stat(segmentPath).catch(() => undefined))?.size ?? 0;
            segmentSizes[index] = existingBytes;
          }
        }
        throw lastError instanceof Error ? lastError : new Error('所有语音资产下载源都不可用。');
      }),
    );
    signal.throwIfAborted();
    const partialPath = this.partialPath(tier.id, tier.version);
    const handle = await open(partialPath, 'w');
    try {
      for (let index = 0; index < segmentCount; index += 1) {
        for await (const chunk of createReadStream(path.join(segmentRoot, `${index}.part`))) {
          signal.throwIfAborted();
          await handle.write(chunk);
        }
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    if ((await stat(partialPath)).size !== tier.bytes) {
      await rm(partialPath, { force: true });
      throw new Error('语音资产分段合并后的体积无效。');
    }
    await rm(segmentRoot, { recursive: true, force: true });
    return partialPath;
  }

  private async activate(tier: SpeechAssetTier, archivePath: string): Promise<void> {
    const targetRoot = path.join(this.speechAssetsRoot, tier.target);
    const stagingRoot = path.join(this.speechAssetsRoot, `.staging-${tier.id}-${randomUUID()}`);
    const backupRoot = path.join(this.speechAssetsRoot, `.backup-${tier.target}-${randomUUID()}`);
    let movedExisting = false;
    try {
      await mkdir(this.speechAssetsRoot, { recursive: true });
      await mkdir(stagingRoot, { recursive: false });
      await writeArchiveToStaging(archivePath, stagingRoot, tier);
      await validateInstalledSpeechAssetTarget(stagingRoot, tier.target);
      if ((await lstat(targetRoot).catch(() => undefined))?.isDirectory()) {
        await rename(targetRoot, backupRoot);
        movedExisting = true;
      }
      await rename(stagingRoot, targetRoot);
      const activeRoot = path.join(this.speechAssetsRoot, 'active');
      await mkdir(activeRoot, { recursive: true });
      const markerPath = path.join(activeRoot, `${tier.id}.json`);
      const temporaryMarker = `${markerPath}.${randomUUID()}.tmp`;
      await writeFile(
        temporaryMarker,
        `${JSON.stringify({ schemaVersion: 2, version: tier.version, sha256: tier.sha256 })}\n`,
        { encoding: 'utf8', mode: 0o600, flag: 'wx' },
      );
      await rename(temporaryMarker, markerPath);
      if (movedExisting) await rm(backupRoot, { recursive: true, force: true });
    } catch (error) {
      await rm(stagingRoot, { recursive: true, force: true });
      if (movedExisting) {
        await rm(targetRoot, { recursive: true, force: true });
        await rename(backupRoot, targetRoot).catch(() => undefined);
      }
      await rm(archivePath, { force: true });
      throw error;
    }
  }
}
