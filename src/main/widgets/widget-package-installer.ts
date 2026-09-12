import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  statfs,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { downloadArchive } from '../assets/download-archive';
import { WIDGET_PACKAGE_INTEGRITY, type WidgetPackageIntegrity } from './widget-package-integrity';
import { inspectWidgetPackage, MAX_WIDGET_PACKAGE_BYTES } from './widget-package-loader';
import { isWidgetId } from '../../shared/widget-contract';
import { detectWindowsMeteredConnection } from '../speech/speech-asset-manager';

interface WidgetDownload {
  id: string;
  version: string;
  urls: string[];
}
const parseDownload = (
  value: unknown,
  local: boolean,
): { request: WidgetDownload; integrity: Readonly<WidgetPackageIntegrity> } => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('小组件下载清单无效。');
  const record = value as Record<string, unknown>;
  if (
    !isWidgetId(record.id) ||
    typeof record.version !== 'string' ||
    !Array.isArray(record.urls) ||
    record.urls.length < 1 ||
    record.urls.length > 4 ||
    Object.keys(record).some((key) => !['id', 'version', 'urls'].includes(key))
  )
    throw new Error('小组件下载清单只能提供 ID、版本和地址。');
  const integrity = Object.hasOwn(WIDGET_PACKAGE_INTEGRITY, record.id)
    ? WIDGET_PACKAGE_INTEGRITY[record.id]
    : null;
  if (
    !integrity ||
    integrity.version !== record.version ||
    integrity.target !== record.id ||
    !/^[a-f0-9]{64}$/u.test(integrity.sha256) ||
    !Number.isSafeInteger(integrity.compressedBytes) ||
    integrity.compressedBytes < 1 ||
    integrity.compressedBytes > MAX_WIDGET_PACKAGE_BYTES ||
    !Number.isSafeInteger(integrity.extractedBytes) ||
    integrity.extractedBytes < 1 ||
    integrity.extractedBytes > MAX_WIDGET_PACKAGE_BYTES ||
    !Number.isInteger(integrity.maxEntries) ||
    integrity.maxEntries < 1 ||
    integrity.maxEntries > 32
  )
    throw new Error('此小组件没有匹配的内置校验记录，暂不可下载。');
  const urls = record.urls.map((raw) => {
    if (typeof raw !== 'string' || raw.length > 2048) throw new Error('小组件下载地址无效。');
    const url = new URL(raw);
    if (
      (url.protocol !== 'https:' &&
        !(local && url.protocol === 'http:' && url.hostname === '127.0.0.1')) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error('小组件下载地址必须是无凭据的 HTTPS。');
    return url.toString();
  });
  return { request: { id: record.id, version: record.version, urls }, integrity };
};

export class WidgetPackageInstaller {
  private readonly active = new Set<string>();
  public constructor(
    private readonly root: string,
    private readonly options: {
      allowLocalhostHttp?: boolean;
      fetch?: typeof fetch;
      detectMetered?: () => Promise<boolean | undefined>;
    } = {},
  ) {}

  /** Main-only; remote content never supplies hashes or destination paths. */
  public async install(value: unknown, cancellation = new AbortController().signal): Promise<void> {
    const { request, integrity } = parseDownload(value, this.options.allowLocalhostHttp === true);
    if (this.active.has(request.id)) throw new Error('此小组件正在安装。');
    this.active.add(request.id);
    let staging: string | undefined;
    let backup: string | undefined;
    let target: string | undefined;
    let activated = false;
    let costTimer: ReturnType<typeof setInterval> | undefined;
    try {
      await mkdir(this.root, { recursive: true });
      if ((await lstat(this.root)).isSymbolicLink()) throw new Error('小组件目录不能是链接。');
      const root = await realpath(this.root);
      target = path.join(root, integrity.target);
      const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (existing && (!existing.isDirectory() || existing.isSymbolicLink()))
        throw new Error('小组件目标目录无效。');
      const disk = await statfs(root);
      if (
        disk.bavail * disk.bsize <
        integrity.compressedBytes * 2 + integrity.extractedBytes + 1024 * 1024
      )
        throw new Error('磁盘空间不足，小组件未安装。');
      const costController = new AbortController();
      const detectCost = this.options.detectMetered ?? detectWindowsMeteredConnection;
      // Explicit installation accepts the current cost (including unknown); a later switch asks again.
      let acceptsCost = (await detectCost().catch(() => undefined)) !== false;
      let checkingCost = false;
      costTimer = setInterval(() => {
        if (checkingCost) return;
        checkingCost = true;
        void detectCost()
          .catch(() => undefined)
          .then((metered) => {
            if (metered === false) acceptsCost = false;
            else if (!acceptsCost)
              costController.abort(
                new Error('网络已切换为计费或未知状态，请确认后重新开始小组件下载。'),
              );
          })
          .finally(() => {
            checkingCost = false;
          });
      }, 10_000);
      const signal = AbortSignal.any([
        cancellation,
        costController.signal,
        AbortSignal.timeout(60_000),
      ]);
      signal.throwIfAborted();
      staging = await mkdtemp(path.join(root, '.widget-stage-'));
      const archive = await downloadArchive({
        partialPath: path.join(staging, 'package.zip'),
        urls: request.urls,
        bytes: integrity.compressedBytes,
        signal,
        fetch: this.options.fetch ?? fetch,
      });
      signal.throwIfAborted();
      const bytes = await readFile(archive);
      if (createHash('sha256').update(bytes).digest('hex') !== integrity.sha256)
        throw new Error('小组件 SHA256 校验失败。');
      // No inflation occurs before the application-owned trust anchor matches.
      const inspected = inspectWidgetPackage(bytes, `${request.id}.zip`, ['input', 'media']);
      const total = [...inspected.files.values()].reduce((sum, file) => sum + file.length, 0);
      if (total > integrity.extractedBytes || inspected.files.size > integrity.maxEntries)
        throw new Error('小组件解压测量与内置记录不符。');
      for (const [name, content] of inspected.files) {
        const destination = path.join(staging, name);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, content, { flag: 'wx', mode: 0o600 });
      }
      signal.throwIfAborted();
      if (existing) {
        backup = path.join(root, `.widget-backup-${randomUUID()}`);
        await rename(target, backup);
      }
      await rename(staging, target);
      activated = true;
      staging = undefined;
      if (backup) await rm(backup, { recursive: true, force: true });
      backup = undefined;
    } finally {
      if (costTimer) clearInterval(costTimer);
      try {
        if (!activated && backup && target) await rename(backup, target);
        if (staging) await rm(staging, { recursive: true, force: true });
      } finally {
        this.active.delete(request.id);
      }
    }
  }
}
