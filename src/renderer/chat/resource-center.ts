import {
  BUNDLED_RESOURCE_CATALOG,
  RESOURCE_CATEGORIES,
  RESOURCE_DEFINITIONS,
  unavailableResourceCenter,
  type ResourceCatalogEntry,
  type ResourceCenterStatus,
} from '../../shared/resource-catalog';
import type {
  SpeechAssetAction,
  SpeechAssetControlInput,
  SpeechAssetDownloadStatus,
  SpeechAssetTierStatus,
  SpeechAssetTierId,
} from '../../shared/speech-asset-ipc';

export interface ResourceCenterDeps {
  getStatus(): Promise<ResourceCenterStatus>;
  refreshCatalog(): Promise<ResourceCenterStatus>;
  control(input: SpeechAssetControlInput): Promise<SpeechAssetDownloadStatus>;
  document?: Document;
  setInterval?: (callback: () => void, milliseconds: number) => number;
  clearInterval?: (timer: number) => void;
}

const bytes = (value: number): string =>
  value >= 1024 * 1024
    ? `${(value / 1024 / 1024).toFixed(1)} MiB`
    : `${Math.ceil(value / 1024)} KiB`;
const stateLabels = {
  pending: '未安装',
  downloading: '下载中',
  paused: '已暂停',
  ready: '已安装',
  error: '下载失败',
};
const nextAction = (tier?: SpeechAssetTierStatus): SpeechAssetAction | undefined =>
  !tier || tier.state === 'ready'
    ? undefined
    : tier.state === 'downloading'
      ? 'pause'
      : tier.state === 'pending'
        ? 'start'
        : 'resume';
const actionLabels = { start: '安装', pause: '暂停', resume: '继续', cancel: '取消下载' };
const foregroundDownload = (tiers: SpeechAssetTierStatus[]): SpeechAssetTierStatus | undefined =>
  tiers.find(({ state }) => state === 'downloading') ??
  tiers.find(({ state }) => state === 'paused');
/** The view submits known IDs/actions only; it never receives download URLs or trust records. */
export const mountResourceCenter = (
  root: HTMLElement,
  compactRoot: HTMLElement,
  deps: ResourceCenterDeps,
): { refresh(): Promise<void>; dispose(): void } => {
  const doc = deps.document ?? document;
  const listeners: (() => void)[] = [];
  const on = (element: HTMLElement, event: string, listener: EventListener): void => {
    element.addEventListener(event, listener);
    listeners.push(() => element.removeEventListener(event, listener));
  };
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = '',
    text = '',
  ): HTMLElementTagNameMap[K] => {
    const element = doc.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  };
  let disposed = false;
  let loading: Promise<void> | undefined;
  let actionBusy = false;
  let snapshot = unavailableResourceCenter();
  let notice = '';
  let category = 'engine';

  const toolbar = make('div', 'resource-center__toolbar');
  const search = make('input');
  search.type = 'search';
  search.placeholder = '搜索资源';
  search.maxLength = 100;
  search.setAttribute('aria-label', '搜索资源');
  const filter = make('select');
  filter.setAttribute('aria-label', '资源筛选');
  for (const [value, label] of [
    ['all', '全部状态'],
    ['installed', '已安装'],
    ['available', '可安装'],
  ]) {
    const option = make('option', '', label);
    option.value = value;
    filter.append(option);
  }
  filter.value = 'all';
  const refreshButton = make('button', 'secondary-button', '刷新目录');
  refreshButton.type = 'button';
  toolbar.append(search, filter, refreshButton);
  const help = make(
    'p',
    'settings-hint',
    '按需安装本地语音。刷新目录只更新资源信息；你可以随时暂停或取消下载。',
  );
  const catalogStatus = make('p', 'settings-status');
  catalogStatus.setAttribute('role', 'status');
  const operationStatus = make('p', 'settings-status');
  operationStatus.setAttribute('role', 'status');
  const list = make('div', 'resource-center__list');
  const overview = make('p', 'resource-center__overview');
  const layout = make('div', 'resource-center__layout');
  const categories = make('nav', 'resource-center__categories');
  categories.setAttribute('aria-label', '资源分类');
  const categoryButtons = new Map<string, HTMLButtonElement>();
  for (const [id, label] of Object.entries(RESOURCE_CATEGORIES)) {
    const button = make('button', 'resource-center__category', label);
    button.type = 'button';
    categoryButtons.set(id, button);
    categories.append(button);
    on(button, 'click', () => {
      category = id;
      render();
    });
  }
  const empty = make('p', 'settings-hint', '没有符合条件的资源。');
  list.append(empty);
  layout.append(categories, list);
  root.replaceChildren(toolbar, help, overview, catalogStatus, operationStatus, layout);
  const cards = new Map<
    string,
    {
      root: HTMLElement;
      title: HTMLElement;
      description: HTMLElement;
      license: HTMLElement;
      metadata: HTMLElement;
      status: HTMLElement;
      message: HTMLElement;
      progress: HTMLProgressElement;
      primary: HTMLButtonElement;
      cancel: HTMLButtonElement;
    }
  >();
  // Keep nodes and listeners stable while polling, so keyboard focus does not jump.
  for (const entry of BUNDLED_RESOURCE_CATALOG.resources) {
    const card = make('article', 'resource-center__card');
    const heading = make('div', 'resource-center__heading');
    const title = make('strong');
    const status = make('span', 'resource-center__state');
    heading.append(title, status);
    const description = make('p', 'resource-center__description');
    const definition = RESOURCE_DEFINITIONS[entry.id];
    const compatibility = make('dl', 'resource-center__details');
    const dependencyNames = definition.dependencies.map(
      (id) => BUNDLED_RESOURCE_CATALOG.resources.find((resource) => resource.id === id)!.name,
    );
    for (const [label, value] of [
      ['适配引擎', definition.compatibility],
      ['支持语言', definition.language],
      ['配套资源', dependencyNames.join('、') || '无需额外引擎组件'],
    ]) {
      compatibility.append(make('dt', '', label), make('dd', '', value));
    }
    const restriction = make(
      'p',
      'resource-center__restriction',
      RESOURCE_DEFINITIONS[entry.id].usageRestriction ?? '',
    );
    restriction.hidden = !restriction.textContent;
    const license = make('small', 'settings-hint');
    const metadata = make('p', 'resource-center__metadata');
    const message = make('p', 'settings-status');
    const progress = make('progress');
    progress.setAttribute('aria-label', `${entry.name}下载进度`);
    const actions = make('div', 'settings-actions');
    const primary = make('button', 'secondary-button');
    const cancel = make('button', 'text-button', '取消下载');
    primary.type = cancel.type = 'button';
    actions.append(primary, cancel);
    card.append(
      heading,
      description,
      compatibility,
      restriction,
      metadata,
      license,
      message,
      progress,
      actions,
    );
    list.append(card);
    cards.set(entry.id, {
      root: card,
      title,
      description,
      license,
      metadata,
      status,
      message,
      progress,
      primary,
      cancel,
    });
    on(primary, 'click', () => {
      const tierId = RESOURCE_DEFINITIONS[entry.id].installTier;
      const action = nextAction(snapshot.downloads.tiers.find(({ id }) => id === entry.id));
      if (action && tierId) void control(tierId, action);
    });
    on(cancel, 'click', () => {
      const tierId = RESOURCE_DEFINITIONS[entry.id].installTier;
      if (tierId) void control(tierId, 'cancel');
    });
  }
  const compactLabel = make('span');
  const compactProgress = make('progress');
  compactProgress.setAttribute('aria-label', '语音资源下载进度');
  const compactButton = make('button', 'secondary-button');
  compactButton.type = 'button';
  compactRoot.replaceChildren(compactLabel, compactProgress, compactButton);
  on(compactButton, 'click', () => {
    const active = foregroundDownload(snapshot.downloads.tiers);
    const action = nextAction(active);
    if (active && action) void control(active.id, action);
  });

  const render = (): void => {
    if (disposed) return;
    refreshButton.disabled = actionBusy;
    refreshButton.textContent = actionBusy ? '正在处理…' : '刷新目录';
    catalogStatus.textContent =
      snapshot.catalogMessage ??
      (snapshot.catalogSource === 'remote' ? '在线目录已更新。' : '内置资源目录');
    const network = snapshot.downloads.metered
      ? '当前网络按流量计费，手动下载会消耗流量。'
      : snapshot.downloads.meteredUnknown
        ? '网络计费状态未知，手动下载可能消耗流量。'
        : '';
    operationStatus.textContent = [notice, network, snapshot.downloads.message]
      .filter(Boolean)
      .join(' ');
    const metadata = new Map(snapshot.catalog.resources.map((entry) => [entry.id, entry]));
    let visible = 0;
    for (const fallback of BUNDLED_RESOURCE_CATALOG.resources) {
      const entry: ResourceCatalogEntry = metadata.get(fallback.id) ?? fallback;
      const card = cards.get(entry.id)!;
      const tier = snapshot.downloads.tiers.find(({ id }) => id === entry.id);
      const query = search.value.trim().toLocaleLowerCase();
      const matches =
        `${entry.name} ${entry.summary}`.toLocaleLowerCase().includes(query) &&
        category === RESOURCE_DEFINITIONS[entry.id].category &&
        (filter.value !== 'installed' || tier?.state === 'ready') &&
        (filter.value !== 'available' || Boolean(tier && tier.state !== 'ready'));
      card.root.hidden = !matches;
      if (matches) visible += 1;
      card.title.textContent = entry.name;
      card.description.textContent = `用途：${entry.summary}`;
      card.license.textContent = `许可说明：${entry.license}`;
      card.status.textContent = tier ? stateLabels[tier.state] : '暂不可安装';
      card.root.setAttribute('data-state', tier?.state ?? 'unavailable');
      const otherVersion =
        entry.latestVersion && tier && entry.latestVersion !== tier.version
          ? ` · 目录版本 ${entry.latestVersion} 需要匹配的应用版本`
          : '';
      card.metadata.textContent = tier
        ? `兼容版本 ${tier.version} · 下载大小 ${bytes(tier.totalBytes)}${otherVersion}`
        : `${entry.latestVersion ? `目录版本 ${entry.latestVersion}` : '版本待发布'} · 下载大小待确认`;
      card.message.textContent =
        tier?.message ??
        (tier
          ? `${bytes(tier.downloadedBytes)} / ${bytes(tier.totalBytes)}`
          : snapshot.downloads.sourceConfigured
            ? '当前应用没有匹配的可安装资源，请稍后刷新目录或更新应用。'
            : '下载服务尚未配置，暂时可以使用已有的在线或本机语音服务。');
      card.progress.hidden = !tier || tier.state === 'pending' || tier.state === 'ready';
      card.progress.max = Math.max(1, tier?.totalBytes ?? 1);
      card.progress.value = Math.min(tier?.downloadedBytes ?? 0, card.progress.max);
      const action = nextAction(tier);
      card.primary.textContent = action
        ? actionLabels[action]
        : tier?.state === 'ready'
          ? '已安装'
          : '暂不可安装';
      card.primary.disabled = actionBusy || !action;
      card.cancel.hidden = !tier || !['downloading', 'paused', 'error'].includes(tier.state);
      card.cancel.disabled = actionBusy;
    }
    empty.hidden = visible > 0;
    overview.textContent = `${BUNDLED_RESOURCE_CATALOG.resources.length} 项资源 · ${snapshot.downloads.tiers.filter(({ state }) => state === 'ready').length} 项已安装`;
    for (const [id, button] of categoryButtons)
      button.setAttribute('aria-pressed', String(id === category));
    const active = foregroundDownload(snapshot.downloads.tiers);
    compactRoot.hidden = !active;
    if (active) {
      const name =
        metadata.get(active.id)?.name ??
        BUNDLED_RESOURCE_CATALOG.resources.find(({ id }) => id === active.id)!.name;
      const otherDownloads = snapshot.downloads.tiers.filter(
        ({ id, state }) => id !== active.id && state === 'downloading',
      ).length;
      compactLabel.textContent = `${network ? `${network} ` : ''}${stateLabels[active.state]} · ${name} · ${bytes(active.downloadedBytes)} / ${bytes(active.totalBytes)}${otherDownloads ? ` · 另有 ${otherDownloads} 项下载中` : ''}`;
      compactProgress.max = Math.max(1, active.totalBytes);
      compactProgress.value = Math.min(active.downloadedBytes, compactProgress.max);
      compactButton.textContent = actionLabels[nextAction(active)!];
      compactButton.disabled = actionBusy;
    }
  };

  const operate = async (operation: () => Promise<ResourceCenterStatus>): Promise<void> => {
    if (disposed || actionBusy) return;
    // Finish the current status read before a mutation, so an older snapshot cannot win later.
    actionBusy = true;
    notice = '';
    render();
    try {
      await loading;
      if (disposed) return;
      snapshot = await operation();
    } catch {
      notice = '操作未完成，请稍后重试；已有资源保持不变。';
    } finally {
      actionBusy = false;
      render();
    }
  };
  const control = async (tierId: SpeechAssetTierId, action: SpeechAssetAction): Promise<void> =>
    operate(async () => {
      const downloads = await deps.control({ tierId, action });
      return { ...snapshot, downloads };
    });
  const refresh = async (): Promise<void> => {
    if (disposed || actionBusy) return;
    loading ??= (async () => {
      try {
        snapshot = await deps.getStatus();
        notice = '';
      } catch {
        notice = '资源状态暂时不可用，请稍后重试。';
      }
      render();
    })();
    const pending = loading;
    try {
      await pending;
    } finally {
      if (loading === pending) loading = undefined;
    }
  };
  on(search, 'input', () => render());
  on(filter, 'change', () => render());
  on(refreshButton, 'click', () => void operate(() => deps.refreshCatalog()));
  render();
  const schedule = deps.setInterval ?? ((callback, ms) => window.setInterval(callback, ms));
  const clear = deps.clearInterval ?? ((timer) => window.clearInterval(timer));
  const timer = schedule(() => void refresh(), 1000);
  void refresh();
  return {
    refresh,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clear(timer);
      for (const remove of listeners) remove();
      root.replaceChildren();
      compactRoot.replaceChildren();
      compactRoot.hidden = true;
    },
  };
};
