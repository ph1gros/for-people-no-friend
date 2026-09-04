import type {
  SpeechAssetAction,
  SpeechAssetControlInput,
  SpeechAssetDownloadStatus,
  SpeechAssetTierId,
  SpeechAssetTierStatus,
} from '../../shared/speech-asset-ipc';

export interface SpeechAssetPanelDeps {
  getStatus(): Promise<SpeechAssetDownloadStatus>;
  control(input: SpeechAssetControlInput): Promise<SpeechAssetDownloadStatus>;
  document?: Document;
  setInterval?: (callback: () => void, milliseconds: number) => number;
  clearInterval?: (timer: number) => void;
}

export interface MountedSpeechAssetPanel {
  refresh(): Promise<void>;
  dispose(): void;
}

export type SpeechInputAssetStartResult = 'ready' | 'started' | 'unavailable';

export const startSpeechInputAssetOnDemand = async (
  getStatus: () => Promise<SpeechAssetDownloadStatus>,
  control: (input: SpeechAssetControlInput) => Promise<SpeechAssetDownloadStatus>,
): Promise<SpeechInputAssetStartResult> => {
  const status = await getStatus();
  if (!status.sourceConfigured) return 'unavailable';
  const tier = status.tiers.find(({ id }) => id === 'speech-input');
  if (!tier) return 'unavailable';
  if (tier.state === 'ready') return 'ready';
  if (tier.state === 'downloading') return 'started';
  const action: SpeechAssetAction =
    tier.state === 'paused' || tier.state === 'error' ? 'resume' : 'start';
  await control({ tierId: 'speech-input', action });
  return 'started';
};

const TIER_LABELS: Readonly<Record<SpeechAssetTierId, string>> = {
  'voice-runtime': '桌宠能说话',
  'speech-input': '我能对它说话',
};

export const speechAssetTierLabel = (id: SpeechAssetTierId): string => TIER_LABELS[id];

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
};

const actionFor = (tier: SpeechAssetTierStatus): SpeechAssetAction | undefined => {
  if (tier.state === 'downloading') return 'pause';
  if (tier.state === 'paused' || tier.state === 'error') return 'resume';
  if (tier.state === 'pending') return 'start';
  return undefined;
};

const actionLabel = (action: SpeechAssetAction): string =>
  ({ start: '下载', pause: '暂停', resume: '继续', cancel: '取消' })[action];

export const mountSpeechAssetDownloadPanel = (
  detailsRoot: HTMLElement,
  compactRoot: HTMLElement,
  deps: SpeechAssetPanelDeps,
): MountedSpeechAssetPanel => {
  const documentRef = deps.document ?? document;
  const schedule =
    deps.setInterval ?? ((callback, milliseconds) => window.setInterval(callback, milliseconds));
  const cancelSchedule = deps.clearInterval ?? ((timer) => window.clearInterval(timer));
  let disposed = false;
  let refreshing = false;

  const runControl = async (
    tierId: SpeechAssetTierId,
    action: SpeechAssetAction,
  ): Promise<void> => {
    if (disposed || refreshing) return;
    refreshing = true;
    try {
      render(await deps.control({ tierId, action }));
    } finally {
      refreshing = false;
    }
  };

  const makeButton = (tierId: SpeechAssetTierId, action: SpeechAssetAction): HTMLButtonElement => {
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.className = 'secondary-button';
    button.textContent = actionLabel(action);
    button.addEventListener('click', () => void runControl(tierId, action));
    return button;
  };

  const renderTier = (tier: SpeechAssetTierStatus): HTMLElement => {
    const card = documentRef.createElement('section');
    card.className = 'speech-asset-download__tier';
    const title = documentRef.createElement('strong');
    title.textContent = speechAssetTierLabel(tier.id);
    const summary = documentRef.createElement('p');
    summary.className = 'settings-status';
    summary.textContent =
      tier.message ??
      `${formatBytes(tier.downloadedBytes)} / ${formatBytes(tier.totalBytes)} · ${tier.state}`;
    const progress = documentRef.createElement('progress');
    progress.max = Math.max(1, tier.totalBytes);
    progress.value = Math.min(tier.downloadedBytes, progress.max);
    const actions = documentRef.createElement('div');
    actions.className = 'settings-actions';
    const primary = actionFor(tier);
    if (primary) actions.append(makeButton(tier.id, primary));
    if (tier.state === 'downloading' || tier.state === 'paused' || tier.state === 'error') {
      actions.append(makeButton(tier.id, 'cancel'));
    }
    card.append(title, summary, progress, actions);
    return card;
  };

  const render = (status: SpeechAssetDownloadStatus): void => {
    if (disposed) return;
    const description = documentRef.createElement('p');
    description.className = 'settings-status';
    description.textContent =
      status.message ??
      (status.sourceConfigured
        ? '语音资产只会安装到当前用户的数据目录。'
        : '尚未配置语音资产下载源。');
    detailsRoot.replaceChildren(description, ...status.tiers.map(renderTier));
    const networkNotice = status.metered
      ? '当前是按流量计费的网络，手动下载会消耗流量。'
      : status.meteredUnknown
        ? '暂时无法确认网络计费状态，手动下载可能消耗流量。'
        : '';
    if (networkNotice && status.tiers.length > 0) {
      const notice = documentRef.createElement('p');
      notice.className = 'settings-status';
      notice.textContent = networkNotice;
      detailsRoot.append(notice);
    }

    const active = status.tiers.find(({ state }) => state === 'downloading' || state === 'paused');
    compactRoot.hidden = !active;
    compactRoot.replaceChildren();
    if (active) {
      compactRoot.textContent = `${networkNotice ? `${networkNotice} ` : ''}正在后台准备语音 · ${formatBytes(active.downloadedBytes)} / ${formatBytes(active.totalBytes)} · `;
      const progress = documentRef.createElement('progress');
      progress.max = Math.max(1, active.totalBytes);
      progress.value = Math.min(active.downloadedBytes, progress.max);
      compactRoot.append(progress, makeButton(active.id, actionFor(active) ?? 'resume'));
    } else {
      compactRoot.textContent = '';
    }
  };

  const refresh = async (): Promise<void> => {
    if (disposed || refreshing) return;
    refreshing = true;
    try {
      render(await deps.getStatus());
    } catch {
      render({
        sourceConfigured: false,
        metered: false,
        busy: false,
        tiers: [],
        message: '语音资产状态暂时不可用，文字聊天不受影响。',
      });
    } finally {
      refreshing = false;
    }
  };

  const timer = schedule(() => void refresh(), 1_000);
  void refresh();
  return {
    refresh,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelSchedule(timer);
      detailsRoot.replaceChildren();
      compactRoot.replaceChildren();
      compactRoot.hidden = true;
    },
  };
};
