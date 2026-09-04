import type { ResourceCenterApi } from '../preload/resource-center';
import { mountResourceCenter } from './chat/resource-center';

const root = document.querySelector<HTMLElement>('#resource-center')!;
const compact = document.querySelector<HTMLElement>('#download-progress')!;
const api = (window as Window & { resourceCenterApi?: ResourceCenterApi }).resourceCenterApi;
if (api) {
  const panel = mountResourceCenter(root, compact, {
    getStatus: () => api.getResourceCenterStatus(),
    refreshCatalog: () => api.refreshResourceCatalog(),
    control: (input) => api.controlSpeechAssetDownload(input),
  });
  window.addEventListener('beforeunload', () => panel.dispose(), { once: true });
} else {
  root.textContent = '资源服务未连接。请从桌宠的“资源中心”入口打开此窗口。';
}
