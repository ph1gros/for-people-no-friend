import './styles.css';
import './resource-center-preview.css';
import { mountResourceCenter } from './chat/resource-center';
import { BUNDLED_RESOURCE_CATALOG, type ResourceCenterStatus } from '../shared/resource-catalog';

if (import.meta.env.DEV) {
  const initial = (): ResourceCenterStatus => ({
    catalog: structuredClone(BUNDLED_RESOURCE_CATALOG),
    catalogSource: 'bundled',
    catalogMessage: '演示目录：体积、版本和进度均为模拟数据。',
    downloads: {
      sourceConfigured: true,
      metered: false,
      busy: false,
      tiers: BUNDLED_RESOURCE_CATALOG.resources.map((resource, index) => ({
        id: resource.id,
        version: resource.latestVersion ?? '0.0.0-demo',
        state: 'pending',
        downloadedBytes: 0,
        totalBytes: (8 + index * 4) * 1024 * 1024,
      })),
    },
  });
  let state = initial();
  const metered = document.querySelector<HTMLInputElement>('#metered')!;
  const offline = document.querySelector<HTMLInputElement>('#offline')!;
  const panel = mountResourceCenter(
    document.querySelector('#resources')!,
    document.querySelector('#compact')!,
    {
      getStatus: async () => structuredClone(state),
      refreshCatalog: async () => {
        state.catalogMessage = offline.checked
          ? '未能更新资源目录，保留上次目录；已安装的资源不会被删除。'
          : '演示目录已刷新，没有自动安装资源。';
        return structuredClone(state);
      },
      control: async ({ tierId, action }) => {
        const tier = state.downloads.tiers.find(({ id }) => id === tierId)!;
        tier.state =
          action === 'cancel' ? 'pending' : action === 'pause' ? 'paused' : 'downloading';
        if (action === 'cancel') tier.downloadedBytes = 0;
        state.downloads.busy = state.downloads.tiers.some(({ state }) => state === 'downloading');
        return structuredClone(state.downloads);
      },
    },
  );
  metered.addEventListener('change', () => {
    state.downloads.metered = metered.checked;
    void panel.refresh();
  });
  document.querySelector('#reset')!.addEventListener('click', () => {
    state = initial();
    metered.checked = offline.checked = false;
    void panel.refresh();
  });
  const timer = window.setInterval(() => {
    for (const tier of state.downloads.tiers) {
      if (tier.state !== 'downloading') continue;
      tier.downloadedBytes = Math.min(tier.totalBytes, tier.downloadedBytes + 256 * 1024);
      if (tier.downloadedBytes === tier.totalBytes) tier.state = 'ready';
    }
    state.downloads.busy = state.downloads.tiers.some(({ state }) => state === 'downloading');
  }, 250);
  window.addEventListener(
    'pagehide',
    () => {
      window.clearInterval(timer);
      panel.dispose();
    },
    { once: true },
  );
}
