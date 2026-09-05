import { execFile } from 'node:child_process';
import path from 'node:path';
import { SPEECH_ASSET_TIER_IDS } from '../../shared/speech-asset-ipc';

import type {
  SpeechAssetControlInput,
  SpeechAssetDownloadStatus,
  SpeechAssetTierId,
  SpeechAssetTierStatus,
} from '../../shared/speech-asset-ipc';
import { isSpeechAssetActivated } from './speech-asset-activation';
import { SPEECH_ASSET_INTEGRITY } from './speech-asset-integrity';
import {
  cleanupOrphanedSpeechAssetWorkspaces,
  fetchSpeechAssetManifest,
  SpeechAssetDownloader,
  validateInstalledSpeechAssetTarget,
  type SpeechAssetInstallStatus,
  type SpeechAssetManifest,
  type SpeechAssetTier,
} from './speech-asset-downloader';

const INITIAL_DOWNLOAD_DELAY_MS = 12_000;

export interface SpeechAssetInstaller {
  install(tier: SpeechAssetTier): Promise<SpeechAssetInstallStatus>;
  pause(id: SpeechAssetTierId): void;
  cancel(id: SpeechAssetTierId, version: string): Promise<void>;
}

interface SpeechAssetManagerOptions {
  loadManifest?: (url: string) => Promise<SpeechAssetManifest>;
  createInstaller?: (
    onProgress: (progress: {
      id: SpeechAssetTierId;
      downloadedBytes: number;
      totalBytes: number;
    }) => void,
  ) => SpeechAssetInstaller;
  detectMetered?: () => Promise<boolean | undefined>;
  delay?: (milliseconds: number) => Promise<void>;
  notify?: (status: SpeechAssetDownloadStatus) => void;
  onTierReady?: (id: SpeechAssetTierId) => Promise<void> | void;
  fetch?: typeof fetch;
  allowLocalhostHttp?: boolean;
  cleanupWorkspaces?: (speechAssetsRoot: string) => Promise<unknown>;
}

const delay = async (milliseconds: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, milliseconds));

export const detectWindowsMeteredConnection = async (): Promise<boolean | undefined> => {
  if (process.platform !== 'win32') return false;
  const command =
    '[Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime] | Out-Null; ' +
    '$profile=[Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile(); ' +
    "if ($null -eq $profile) { 'Unknown' } else { $profile.GetConnectionCost().NetworkCostType.ToString() }";
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  }).catch(() => 'Unknown');
  const cost = output.trim();
  if (/^(?:Fixed|Variable)$/iu.test(cost)) return true;
  if (/^Unrestricted$/iu.test(cost)) return false;
  return undefined;
};

export class SpeechAssetManager {
  private manifest: Promise<SpeechAssetManifest | undefined> | undefined;
  private restored: Promise<void> | undefined;
  private cleanup: Promise<void> | undefined;
  private networkCheck: Promise<void> | undefined;
  private readonly states = new Map<SpeechAssetTierId, SpeechAssetTierStatus>();
  private readonly active = new Set<SpeechAssetTierId>();
  private readonly operationVersions = new Map<SpeechAssetTierId, number>();
  private readonly installer: SpeechAssetInstaller;
  private metered: boolean | undefined;
  private message: string | undefined;
  private manifestMessage: string | undefined;
  private disposed = false;
  private networkWatch: ReturnType<typeof setInterval> | undefined;
  private networkWatchInFlight = false;
  private readonly meteredConsent = new Set<SpeechAssetTierId>();

  public constructor(
    private readonly speechAssetsRoot: string,
    private readonly manifestUrl: string | undefined,
    private readonly options: SpeechAssetManagerOptions = {},
  ) {
    this.installer =
      options.createInstaller?.((progress) => this.updateProgress(progress)) ??
      new SpeechAssetDownloader(speechAssetsRoot, {
        fetch: options.fetch,
        allowLocalhostHttp: options.allowLocalhostHttp,
        onProgress: (progress) => this.updateProgress(progress),
      });
  }

  public async getStatus(): Promise<SpeechAssetDownloadStatus> {
    const manifest = await this.loadManifest();
    const message = this.message ?? this.manifestMessage;
    return {
      sourceConfigured: Boolean(this.manifestUrl),
      metered: this.metered === true,
      ...(this.metered === undefined ? { meteredUnknown: true } : {}),
      busy: this.active.size > 0,
      tiers: manifest?.tiers.map((tier) => this.stateFor(tier)) ?? [],
      ...(message ? { message } : {}),
    };
  }

  public async refreshManifest(): Promise<SpeechAssetDownloadStatus> {
    if (!this.disposed && this.active.size === 0) {
      this.manifest = undefined;
      this.restored = undefined;
    }
    return this.getStatus();
  }

  public async initialize(): Promise<void> {
    if (!this.disposed) await this.ensureWorkspaceCleanup();
  }

  public async getInstalledTiers(): Promise<SpeechAssetTierStatus[]> {
    const tiers: SpeechAssetTier[] = [];
    for (const id of SPEECH_ASSET_TIER_IDS) {
      const integrity = SPEECH_ASSET_INTEGRITY[id];
      if (integrity) tiers.push({ ...integrity, id, bytes: integrity.compressedBytes, urls: [] });
    }
    // Inventory never installs: an offline catalog must still show validated local resources.
    await this.restorePersistedStates({ schemaVersion: 2, tiers });
    return [...this.states.values()]
      .filter(({ state }) => state === 'ready')
      .map((tier) => ({ ...tier }));
  }

  public async control(input: SpeechAssetControlInput): Promise<SpeechAssetDownloadStatus> {
    if (this.disposed) return this.getStatus();
    const manifest = await this.loadManifest();
    if (this.disposed) return this.getStatus();
    const tier = manifest?.tiers.find(({ id }) => id === input.tierId);
    if (!tier) {
      this.message = this.manifestUrl
        ? '这个语音资产档位不在当前清单中。'
        : '尚未配置语音资产下载源。';
      return this.getStatus();
    }
    if (input.action === 'pause') {
      if (!this.active.has(tier.id)) this.invalidateOperation(tier.id);
      this.installer.pause(tier.id);
      const current = this.stateFor(tier);
      this.states.set(tier.id, { ...current, state: 'paused', message: '已暂停。' });
      await this.emit();
    } else if (input.action === 'cancel') {
      this.invalidateOperation(tier.id);
      await this.installer.cancel(tier.id, tier.version);
      this.active.delete(tier.id);
      this.stopIdleNetworkWatch();
      this.states.set(tier.id, {
        id: tier.id,
        version: tier.version,
        state: 'pending',
        downloadedBytes: 0,
        totalBytes: tier.bytes,
      });
      await this.emit();
    } else if (!this.active.has(tier.id)) {
      this.invalidateOperation(tier.id);
      const operationVersion = this.operationVersions.get(tier.id);
      await this.ensureWorkspaceCleanup();
      await this.refreshNetworkCost();
      if (
        this.disposed ||
        this.active.has(tier.id) ||
        this.operationVersions.get(tier.id) !== operationVersion
      )
        return this.getStatus();
      void this.runInstall(tier);
    }
    return this.getStatus();
  }

  public async scheduleInitialDownload(): Promise<void> {
    // Reclaim disk from any staging or backup tree a previous hard kill left behind. This runs
    // even without a configured source, because the orphans are unrelated to the manifest.
    if (this.disposed) return;
    await this.ensureWorkspaceCleanup();
    if (this.disposed) return;
    if (!this.manifestUrl) return;
    const operationVersion = this.operationVersions.get('voice-runtime');
    await (this.options.delay ?? delay)(INITIAL_DOWNLOAD_DELAY_MS);
    if (this.disposed) return;
    const manifest = await this.loadManifest();
    const firstTier = manifest?.tiers.find(({ id }) => id === 'voice-runtime');
    if (
      !firstTier ||
      this.active.has(firstTier.id) ||
      this.stateFor(firstTier).state !== 'pending'
    ) {
      return;
    }
    await this.refreshNetworkCost();
    if (this.disposed || this.operationVersions.get(firstTier.id) !== operationVersion) return;
    if (this.metered !== false) {
      this.message = this.metered
        ? '检测到按流量计费的网络，语音资产自动下载已暂停。'
        : '无法确认网络是否按流量计费，语音资产自动下载已暂停，可手动下载。';
      await this.emit();
      return;
    }
    if (!this.active.has(firstTier.id) && this.stateFor(firstTier).state === 'pending') {
      void this.runInstall(firstTier);
    }
  }

  private ensureWorkspaceCleanup(): Promise<void> {
    this.cleanup ??= Promise.resolve()
      .then(() =>
        (this.options.cleanupWorkspaces ?? cleanupOrphanedSpeechAssetWorkspaces)(
          this.speechAssetsRoot,
        ),
      )
      .then(
        () => undefined,
        () => undefined,
      );
    return this.cleanup;
  }

  private async refreshNetworkCost(): Promise<void> {
    // Coalesce concurrent clicks; later start/resume actions always refresh the value.
    this.networkCheck ??= Promise.resolve()
      .then(() => (this.options.detectMetered ?? detectWindowsMeteredConnection)())
      .catch(() => undefined)
      .then((metered) => {
        this.metered = metered;
      });
    const check = this.networkCheck;
    await check;
    if (this.networkCheck === check) this.networkCheck = undefined;
  }

  public dispose(): void {
    this.disposed = true;
    if (this.networkWatch) clearInterval(this.networkWatch);
    this.networkWatch = undefined;
    for (const id of this.active) {
      this.invalidateOperation(id);
      this.installer.pause(id);
    }
    this.active.clear();
  }

  private stopIdleNetworkWatch(): void {
    if (this.active.size || !this.networkWatch) return;
    clearInterval(this.networkWatch);
    this.networkWatch = undefined;
  }

  private async checkActiveNetworkCost(): Promise<void> {
    if (this.disposed || !this.active.size || this.networkWatchInFlight) return;
    this.networkWatchInFlight = true;
    try {
      await this.refreshNetworkCost();
      if (this.disposed) return;
      if (this.metered === false) {
        this.meteredConsent.clear();
        return;
      }
      for (const id of this.active) {
        // Explicit start/resume accepts the current metered or unknown cost. The unmetered
        // branch above clears that consent, so a later switch still pauses and asks via status.
        if (this.meteredConsent.has(id)) continue;
        this.installer.pause(id);
        this.message = this.metered
          ? '网络已切换为按流量计费，下载已暂停；点击继续可使用当前网络下载。'
          : '无法确认当前网络是否按流量计费，下载已暂停；可手动继续。';
      }
      await this.emit();
    } finally {
      this.networkWatchInFlight = false;
    }
  }

  private async loadManifest(): Promise<SpeechAssetManifest | undefined> {
    if (!this.manifestUrl) return undefined;
    const pending = (this.manifest ??= (
      this.options.loadManifest?.(this.manifestUrl) ??
      fetchSpeechAssetManifest(this.manifestUrl, {
        fetch: this.options.fetch,
        allowLocalhostHttp: this.options.allowLocalhostHttp,
      })
    )
      .then((manifest) => {
        this.manifestMessage =
          manifest.tiers.length === 0
            ? '当前版本暂无可下载的已验证语音资源，文字聊天和已配置的语音服务仍可使用。'
            : undefined;
        return manifest;
      })
      .catch((error) => {
        this.manifestMessage =
          error instanceof Error ? error.message : '语音资产清单暂时不可用，文字聊天不受影响。';
        return undefined;
      }));
    const manifest = await pending;
    if (!manifest) {
      // A failed fetch must not be cached for the life of the session: an auto-started desk pet
      // is often running before the network is ready, and the user would otherwise have to
      // restart the app. Drop the cache so the next call retries.
      if (this.manifest === pending) this.manifest = undefined;
      return undefined;
    }
    this.restored ??= this.restorePersistedStates(manifest);
    await this.restored;
    return manifest;
  }

  private async restorePersistedStates(manifest: SpeechAssetManifest): Promise<void> {
    await Promise.all(
      manifest.tiers.map(async (tier) => {
        if (this.states.has(tier.id) || this.active.has(tier.id)) return;
        try {
          if (!(await isSpeechAssetActivated(this.speechAssetsRoot, tier.id))) return;
          await validateInstalledSpeechAssetTarget(
            path.join(this.speechAssetsRoot, tier.target),
            tier.target,
          );
          this.states.set(tier.id, {
            id: tier.id,
            version: tier.version,
            state: 'ready',
            downloadedBytes: tier.bytes,
            totalBytes: tier.bytes,
            message: '本地语音资产已就绪。',
          });
        } catch {
          // A stale, malformed, or incomplete marker must never make assets look ready.
        }
      }),
    );
  }

  private stateFor(tier: SpeechAssetTier): SpeechAssetTierStatus {
    return (
      this.states.get(tier.id) ?? {
        id: tier.id,
        version: tier.version,
        state: 'pending',
        downloadedBytes: 0,
        totalBytes: tier.bytes,
      }
    );
  }

  private updateProgress(progress: {
    id: SpeechAssetTierId;
    downloadedBytes: number;
    totalBytes: number;
  }): void {
    const current = this.states.get(progress.id);
    this.states.set(progress.id, {
      id: progress.id,
      version: current?.version ?? '',
      state: 'downloading',
      downloadedBytes: progress.downloadedBytes,
      totalBytes: progress.totalBytes,
    });
    void this.emit();
  }

  private async runInstall(tier: SpeechAssetTier): Promise<void> {
    const operationVersion = (this.operationVersions.get(tier.id) ?? 0) + 1;
    this.operationVersions.set(tier.id, operationVersion);
    this.active.add(tier.id);
    if (this.metered !== false) this.meteredConsent.add(tier.id);
    else this.meteredConsent.delete(tier.id);
    if (!this.networkWatch) {
      this.networkWatch = setInterval(() => {
        void this.checkActiveNetworkCost().catch(() => undefined);
      }, 10_000);
      this.networkWatch.unref?.();
    }
    this.message = undefined;
    this.states.set(tier.id, {
      id: tier.id,
      version: tier.version,
      state: 'downloading',
      downloadedBytes: this.states.get(tier.id)?.downloadedBytes ?? 0,
      totalBytes: tier.bytes,
    });
    await this.emit();
    try {
      const result = await this.installer.install(tier);
      if (this.operationVersions.get(tier.id) !== operationVersion) return;
      this.states.set(tier.id, {
        id: tier.id,
        version: tier.version,
        state: result.state,
        downloadedBytes: result.downloadedBytes,
        totalBytes: result.totalBytes,
        message: result.state === 'ready' ? '本地语音资产已就绪。' : '已暂停。',
      });
      if (result.state === 'ready') {
        await Promise.resolve(this.options.onTierReady?.(tier.id)).catch(() => undefined);
      }
    } catch (error) {
      if (this.operationVersions.get(tier.id) !== operationVersion) return;
      this.states.set(tier.id, {
        ...this.stateFor(tier),
        state: 'error',
        message: error instanceof Error ? error.message : '语音资产下载失败，可稍后重试。',
      });
    } finally {
      if (this.operationVersions.get(tier.id) === operationVersion) {
        this.active.delete(tier.id);
        this.meteredConsent.delete(tier.id);
        this.stopIdleNetworkWatch();
        await this.emit();
      }
    }
  }

  private invalidateOperation(id: SpeechAssetTierId): void {
    this.operationVersions.set(id, (this.operationVersions.get(id) ?? 0) + 1);
  }

  private async emit(): Promise<void> {
    this.options.notify?.(await this.getStatus());
  }
}
