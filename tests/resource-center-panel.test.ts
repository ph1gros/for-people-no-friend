import { describe, expect, it, vi } from 'vitest';
import { mountResourceCenter } from '../src/renderer/chat/resource-center';
import {
  BUNDLED_RESOURCE_CATALOG,
  type ResourceCenterStatus,
} from '../src/shared/resource-catalog';

class Element extends EventTarget {
  children: Element[] = [];
  className = '';
  textContent = '';
  value = '';
  hidden = false;
  disabled = false;
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  append(...elements: Element[]): void {
    this.children.push(...elements);
  }
  replaceChildren(...elements: Element[]): void {
    this.children = elements;
  }
}
const doc = { createElement: () => new Element() } as unknown as Document;
const all = (node: Element): Element[] => [node, ...node.children.flatMap(all)];
const text = (node: Element): string =>
  all(node)
    .map((item) => item.textContent)
    .join(' ');
const initial = (): ResourceCenterStatus => ({
  catalog: BUNDLED_RESOURCE_CATALOG,
  catalogSource: 'bundled',
  downloads: {
    sourceConfigured: true,
    metered: false,
    busy: false,
    tiers: [
      {
        id: 'speech-input',
        version: '1.0.0',
        state: 'pending',
        downloadedBytes: 0,
        totalBytes: 4096,
      },
    ],
  },
});

describe('resource center panel', () => {
  it('uses the same description fields in every category', async () => {
    const root = new Element();
    const mounted = mountResourceCenter(
      root as unknown as HTMLElement,
      new Element() as unknown as HTMLElement,
      {
        document: doc,
        getStatus: async () => initial(),
        refreshCatalog: async () => initial(),
        control: async () => initial().downloads,
        setInterval: () => 1,
        clearInterval: vi.fn(),
      },
    );
    await mounted.refresh();
    for (const category of ['引擎', '基础模型', '音色模型', '语音识别']) {
      all(root)
        .find((node) => node.textContent === category)!
        .dispatchEvent(new Event('click'));
      const cards = all(root).filter((node) => node.className === 'resource-center__card');
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        for (const label of ['用途：', '适配引擎', '支持语言', '配套资源', '许可说明：']) {
          expect(text(card)).toContain(label);
        }
      }
    }
    mounted.dispose();
  });
  it('keeps a paused companion from hiding another active download or receiving its pause action', async () => {
    const root = new Element();
    const compact = new Element();
    const snapshot = initial();
    snapshot.downloads.tiers = [
      {
        id: 'voice-runtime',
        version: '1.0.0',
        state: 'paused',
        downloadedBytes: 100,
        totalBytes: 4096,
      },
      {
        id: 'speech-input',
        version: '1.0.0',
        state: 'downloading',
        downloadedBytes: 512,
        totalBytes: 4096,
      },
      {
        id: 'bert-japanese',
        version: '1.0.0',
        state: 'downloading',
        downloadedBytes: 128,
        totalBytes: 4096,
      },
    ];
    const control = vi.fn(async ({ tierId }) => {
      snapshot.downloads.tiers.find(({ id }) => id === tierId)!.state = 'paused';
      return snapshot.downloads;
    });
    const mounted = mountResourceCenter(
      root as unknown as HTMLElement,
      compact as unknown as HTMLElement,
      {
        document: doc,
        getStatus: async () => snapshot,
        refreshCatalog: async () => snapshot,
        control,
        setInterval: () => 1,
        clearInterval: vi.fn(),
      },
    );
    await mounted.refresh();
    expect(text(compact)).toContain('下载中 · SenseVoiceSmall 语音识别模型');
    expect(text(compact)).toContain('另有 1 项下载中');
    all(compact)
      .find((node) => node.textContent === '暂停')!
      .dispatchEvent(new Event('click'));
    await vi.waitFor(() =>
      expect(control).toHaveBeenCalledWith({ tierId: 'speech-input', action: 'pause' }),
    );
    await vi.waitFor(() => expect(text(compact)).toContain('下载中 · 日语 DeBERTa 基础模型'));
    mounted.dispose();
  });

  it('shows exactly four resource categories without combined overview cards', async () => {
    const root = new Element();
    const compact = new Element();
    const control = vi.fn();
    const mounted = mountResourceCenter(
      root as unknown as HTMLElement,
      compact as unknown as HTMLElement,
      {
        document: doc,
        getStatus: async () => initial(),
        refreshCatalog: async () => initial(),
        control,
        setInterval: () => 1,
        clearInterval: vi.fn(),
      },
    );
    await mounted.refresh();
    const categories = all(root).filter((node) => node.className === 'resource-center__category');
    expect(categories.map((node) => node.textContent)).toEqual([
      '引擎',
      '基础模型',
      '音色模型',
      '语音识别',
    ]);
    expect(text(root)).not.toContain('全部资源');
    expect(all(root).some((node) => node.className === 'resource-center__readiness-card')).toBe(
      false,
    );
    const visible = () =>
      all(root).filter((node) => node.className === 'resource-center__card' && !node.hidden);
    expect(visible()).toHaveLength(2);
    for (const category of categories.slice(1)) {
      category.dispatchEvent(new Event('click'));
      expect(visible()).toHaveLength(category.textContent === '语音识别' ? 1 : 2);
    }
    expect(control).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it('shows unavailable resources honestly, searches, filters and refreshes without installing', async () => {
    const root = new Element();
    const compact = new Element();
    const control = vi.fn();
    const refreshCatalog = vi.fn(async () => initial());
    const mounted = mountResourceCenter(
      root as unknown as HTMLElement,
      compact as unknown as HTMLElement,
      {
        document: doc,
        getStatus: async () => initial(),
        refreshCatalog,
        control,
        setInterval: () => 1,
        clearInterval: vi.fn(),
      },
    );
    await mounted.refresh();
    expect(text(root)).toContain('Style-Bert-VITS2 引擎');
    expect(text(root)).toContain('暂不可安装');
    expect(text(root)).toContain('兼容版本 1.0.0');
    const category = all(root).find((node) => node.textContent === '音色模型')!;
    category.dispatchEvent(new Event('click'));
    expect(category.attributes.get('aria-pressed')).toBe('true');
    expect(
      all(root).filter((node) => node.className === 'resource-center__card' && !node.hidden),
    ).toHaveLength(2);
    const voices = all(root)
      .filter((node) => node.className === 'resource-center__card' && !node.hidden)
      .map(text)
      .join(' ');
    expect(voices).toContain('伊蕾娜音色模型');
    expect(voices).toContain('仅限非商业使用');
    expect(voices).toContain('圣园未花（Mika）');
    expect(voices).toContain('角色出自《蔚蓝档案》');
    all(root)
      .find(
        (node) => node.className === 'resource-center__category' && node.textContent === '语音识别',
      )!
      .dispatchEvent(new Event('click'));
    const search = all(root).find((node) => node.attributes.get('aria-label') === '搜索资源')!;
    search.value = 'SenseVoice';
    search.dispatchEvent(new Event('input'));
    expect(
      all(root).filter((node) => node.className === 'resource-center__card' && !node.hidden),
    ).toHaveLength(1);
    all(root)
      .find((node) => node.textContent === '刷新目录')!
      .dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(refreshCatalog).toHaveBeenCalledOnce());
    expect(control).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it('installs and pauses through the existing narrow action contract, then disposes listeners', async () => {
    const root = new Element();
    const compact = new Element();
    const snapshot = initial();
    const control = vi.fn(async ({ action }) => {
      snapshot.downloads.tiers[0]!.state = action === 'pause' ? 'paused' : 'downloading';
      snapshot.downloads.metered = true;
      return snapshot.downloads;
    });
    const clearInterval = vi.fn();
    const mounted = mountResourceCenter(
      root as unknown as HTMLElement,
      compact as unknown as HTMLElement,
      {
        document: doc,
        getStatus: async () => snapshot,
        refreshCatalog: async () => snapshot,
        control,
        setInterval: () => 42,
        clearInterval,
      },
    );
    await mounted.refresh();
    all(root)
      .find(
        (node) => node.className === 'resource-center__category' && node.textContent === '语音识别',
      )!
      .dispatchEvent(new Event('click'));
    const install = all(root).find((node) => node.textContent === '安装')!;
    install.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(text(compact)).toContain('下载中'));
    expect(control).toHaveBeenCalledWith({ tierId: 'speech-input', action: 'start' });
    expect(text(compact)).toContain('按流量计费');
    all(compact)
      .find((node) => node.textContent === '暂停')!
      .dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(text(compact)).toContain('已暂停'));
    mounted.dispose();
    install.dispatchEvent(new Event('click'));
    expect(control).toHaveBeenCalledTimes(2);
    expect(clearInterval).toHaveBeenCalledWith(42);
    expect(root.children).toEqual([]);
  });

  it('renders remote descriptions as text and handles a failed catalog action without clearing cards', async () => {
    const root = new Element();
    const compact = new Element();
    const snapshot = initial();
    snapshot.catalog = structuredClone(snapshot.catalog);
    snapshot.catalog.resources[0]!.summary = '<img src=x onerror=alert(1)>';
    snapshot.catalog.resources.find(({ id }) => id === 'voice-ireina')!.license =
      'remote text cannot remove local restrictions';
    const mounted = mountResourceCenter(
      root as unknown as HTMLElement,
      compact as unknown as HTMLElement,
      {
        document: doc,
        getStatus: async () => snapshot,
        refreshCatalog: async () => {
          throw new Error('offline');
        },
        control: vi.fn(),
        setInterval: () => 1,
        clearInterval: vi.fn(),
      },
    );
    await mounted.refresh();
    expect(text(root)).toContain('<img src=x onerror=alert(1)>');
    expect(text(root)).toContain('仅限非商业使用；复制、分享和再分发时须保留随附使用说明');
    all(root)
      .find((node) => node.textContent === '刷新目录')!
      .dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(text(root)).toContain('操作未完成'));
    expect(text(root)).toContain('SenseVoiceSmall 语音识别模型');
    mounted.dispose();
  });
});
