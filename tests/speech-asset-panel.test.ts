import { describe, expect, it, vi } from 'vitest';

import {
  mountSpeechAssetDownloadPanel,
  speechAssetTierLabel,
  startSpeechInputAssetOnDemand,
} from '../src/renderer/chat/speech-asset-panel';
import type { SpeechAssetDownloadStatus } from '../src/shared/speech-asset-ipc';

class FakeElement extends EventTarget {
  public children: FakeElement[] = [];
  public className = '';
  public textContent = '';
  public hidden = false;
  public disabled = false;
  public value = 0;
  public max = 1;
  public type = '';

  public append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  public replaceChildren(...children: FakeElement[]): void {
    this.children = children;
  }
}

const fakeDocument = {
  createElement: () => new FakeElement(),
} as unknown as Document;

const status = (
  state: 'pending' | 'downloading' | 'paused' | 'ready',
): SpeechAssetDownloadStatus => ({
  sourceConfigured: true,
  metered: false,
  busy: state === 'downloading',
  tiers: [
    {
      id: 'voice-runtime',
      version: '1.0.0',
      state,
      downloadedBytes: state === 'pending' ? 0 : 120,
      totalBytes: 240,
    },
  ],
});

describe('speech asset download panel', () => {
  it('uses stable Chinese labels for every manifest tier', () => {
    expect(speechAssetTierLabel('voice-runtime')).toBe('桌宠能说话');
    expect(speechAssetTierLabel('speech-input')).toBe('我能对它说话');
  });

  it('renders a non-modal progress strip and disposes polling', async () => {
    const detailsRoot = new FakeElement();
    const compactRoot = new FakeElement();
    const getStatus = vi.fn(async () => status('downloading'));
    const control = vi.fn(async () => status('paused'));
    const clearInterval = vi.fn();
    const mounted = mountSpeechAssetDownloadPanel(
      detailsRoot as unknown as HTMLElement,
      compactRoot as unknown as HTMLElement,
      {
        document: fakeDocument,
        getStatus,
        control,
        setInterval: vi.fn(() => 42),
        clearInterval,
      },
    );

    await mounted.refresh();

    expect(compactRoot.hidden).toBe(false);
    expect(
      compactRoot.textContent + compactRoot.children.map((child) => child.textContent).join(' '),
    ).toContain('正在后台准备语音');
    expect(detailsRoot.children.length).toBeGreaterThan(0);
    mounted.dispose();
    expect(clearInterval).toHaveBeenCalledWith(42);
  });

  it('stays hidden outside settings when no source is configured', async () => {
    const detailsRoot = new FakeElement();
    const compactRoot = new FakeElement();
    const mounted = mountSpeechAssetDownloadPanel(
      detailsRoot as unknown as HTMLElement,
      compactRoot as unknown as HTMLElement,
      {
        document: fakeDocument,
        getStatus: vi.fn(async () => ({
          sourceConfigured: false,
          metered: false,
          busy: false,
          tiers: [],
          message: '尚未配置语音资产下载源。',
        })),
        control: vi.fn(),
        setInterval: vi.fn(() => 1),
        clearInterval: vi.fn(),
      },
    );

    await mounted.refresh();

    expect(compactRoot.hidden).toBe(true);
    expect(detailsRoot.children.map((child) => child.textContent).join(' ')).toContain(
      '尚未配置语音资产下载源',
    );
    mounted.dispose();
  });

  it.each([
    { metered: true, meteredUnknown: false, notice: '当前是按流量计费的网络' },
    { metered: false, meteredUnknown: true, notice: '暂时无法确认网络计费状态' },
  ])(
    'shows the network notice during an explicit download ($notice)',
    async ({ metered, meteredUnknown, notice }) => {
      const detailsRoot = new FakeElement();
      const compactRoot = new FakeElement();
      const mounted = mountSpeechAssetDownloadPanel(
        detailsRoot as unknown as HTMLElement,
        compactRoot as unknown as HTMLElement,
        {
          document: fakeDocument,
          getStatus: async () => ({ ...status('downloading'), metered, meteredUnknown }),
          control: vi.fn(),
          setInterval: () => 1,
          clearInterval: vi.fn(),
        },
      );
      await mounted.refresh();
      expect(compactRoot.textContent).toContain(notice);
      expect(detailsRoot.children.map((child) => child.textContent).join(' ')).toContain(notice);
      mounted.dispose();
    },
  );

  it('starts or resumes speech input assets on the first microphone action', async () => {
    const control = vi.fn(async () => status('downloading'));
    await expect(
      startSpeechInputAssetOnDemand(
        async () => ({
          ...status('pending'),
          tiers: [
            {
              id: 'speech-input',
              version: '1.0.0',
              state: 'pending',
              downloadedBytes: 0,
              totalBytes: 225,
            },
          ],
        }),
        control,
      ),
    ).resolves.toBe('started');
    expect(control).toHaveBeenCalledWith({ tierId: 'speech-input', action: 'start' });

    control.mockClear();
    await startSpeechInputAssetOnDemand(
      async () => ({
        ...status('paused'),
        tiers: [
          {
            id: 'speech-input',
            version: '1.0.0',
            state: 'paused',
            downloadedBytes: 100,
            totalBytes: 225,
          },
        ],
      }),
      control,
    );
    expect(control).toHaveBeenCalledWith({ tierId: 'speech-input', action: 'resume' });
  });
});
