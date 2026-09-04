import {
  BUNDLED_RESOURCE_CATALOG,
  parseResourceCatalog,
  type ResourceCatalog,
  type ResourceCenterStatus,
} from '../../shared/resource-catalog';
import type {
  SpeechAssetDownloadStatus,
  SpeechAssetTierStatus,
} from '../../shared/speech-asset-ipc';

const CATALOG_MAX_BYTES = 128 * 1024;
interface CatalogNetworkOptions {
  fetch?: typeof fetch;
  allowLocalhostHttp?: boolean;
  signal?: AbortSignal;
}

export const fetchResourceCatalog = async (
  address: string,
  options: CatalogNetworkOptions = {},
): Promise<ResourceCatalog> => {
  if (address.length > 2048) throw new Error('资源目录地址无效。');
  const url = new URL(address);
  const local =
    options.allowLocalhostHttp === true &&
    url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.hash) {
    throw new Error('资源目录必须使用 HTTPS。');
  }
  const timeout = AbortSignal.timeout(8000);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  const response = await (options.fetch ?? fetch)(url.toString(), {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('资源目录读取失败。');
  }
  if (Number(response.headers.get('content-length')) > CATALOG_MAX_BYTES) {
    await response.body?.cancel();
    throw new Error('资源目录过大。');
  }
  if (!response.body) throw new Error('资源目录为空。');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > CATALOG_MAX_BYTES) throw new Error('资源目录过大。');
      chunks.push(value);
    }
    return parseResourceCatalog(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
};

interface DownloadInventory {
  getStatus(): Promise<SpeechAssetDownloadStatus>;
  refreshManifest(): Promise<SpeechAssetDownloadStatus>;
  getInstalledTiers?(): Promise<SpeechAssetTierStatus[]>;
}

/** Reading/refreshing a catalog has no installation capability. */
export class ResourceCenter {
  private catalog = BUNDLED_RESOURCE_CATALOG;
  private catalogSource: 'bundled' | 'remote' = 'bundled';
  private catalogMessage: string | undefined;
  private checkedAt: string | undefined;
  private initialized = false;
  private loading: Promise<void> | undefined;
  private refreshing: Promise<ResourceCenterStatus> | undefined;
  private readonly lifetime = new AbortController();

  public constructor(
    private readonly downloads: DownloadInventory,
    private readonly catalogUrl?: string,
    private readonly options: CatalogNetworkOptions = {},
  ) {}

  public async getStatus(): Promise<ResourceCenterStatus> {
    if (!this.initialized) await this.loadCatalog();
    const downloads = await this.downloads.getStatus();
    const installed = (await this.downloads.getInstalledTiers?.()) ?? [];
    const tiers = [
      ...downloads.tiers,
      ...installed.filter((entry) => !downloads.tiers.some(({ id }) => id === entry.id)),
    ];
    return {
      catalog: this.catalog,
      catalogSource: this.catalogSource,
      ...(this.catalogMessage ? { catalogMessage: this.catalogMessage } : {}),
      ...(this.checkedAt ? { checkedAt: this.checkedAt } : {}),
      downloads: { ...downloads, tiers },
    };
  }

  public async refresh(): Promise<ResourceCenterStatus> {
    if (this.lifetime.signal.aborted) return this.getStatus();
    this.refreshing ??= (async () => {
      await this.loadCatalog();
      // Refreshing routes only affects future explicit installs. Active transfers are retained.
      await this.downloads.refreshManifest();
      return this.getStatus();
    })();
    const pending = this.refreshing;
    try {
      return await pending;
    } finally {
      if (this.refreshing === pending) this.refreshing = undefined;
    }
  }

  public dispose(): void {
    this.lifetime.abort();
  }

  private async loadCatalog(): Promise<void> {
    if (this.lifetime.signal.aborted) {
      this.initialized = true;
      return;
    }
    this.loading ??= (async () => {
      if (!this.catalogUrl) {
        this.catalogMessage = '当前显示内置资源目录，在线目录尚未配置。';
        return;
      }
      try {
        const catalog = await fetchResourceCatalog(this.catalogUrl, {
          ...this.options,
          signal: this.lifetime.signal,
        });
        if (this.lifetime.signal.aborted) return;
        this.catalog = catalog;
        this.catalogSource = 'remote';
        this.catalogMessage = undefined;
        this.checkedAt = new Date().toISOString();
      } catch {
        this.catalogMessage = '未能更新资源目录，保留上次目录；已安装的资源不会被删除。';
      }
    })();
    const pending = this.loading;
    try {
      await pending;
    } finally {
      this.initialized = true;
      if (this.loading === pending) this.loading = undefined;
    }
  }
}
