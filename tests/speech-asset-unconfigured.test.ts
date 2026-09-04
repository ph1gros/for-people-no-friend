import { describe, expect, it, vi } from 'vitest';

import {
  parseSpeechAssetManifest,
  SpeechAssetDownloader,
} from '../src/main/speech/speech-asset-downloader';
import { SpeechAssetManager } from '../src/main/speech/speech-asset-manager';

describe('unconfigured production speech assets', () => {
  it('does not download or enable an archive without a compiled trust anchor', async () => {
    const manifest = {
      schemaVersion: 2,
      tiers: [
        {
          id: 'voice-runtime',
          version: '1.0.0',
          urls: ['https://assets.example.com/unapproved.zip'],
        },
      ],
    };
    expect(parseSpeechAssetManifest(manifest).tiers).toEqual([]);
    const fetcher = vi.fn();
    const downloader = new SpeechAssetDownloader('unused-no-files-created', { fetch: fetcher });
    await expect(
      downloader.install({
        ...manifest.tiers[0]!,
        id: 'voice-runtime',
        target: 'voice-runtime',
        sha256: 'a'.repeat(64),
        bytes: 1,
        extractedBytes: 1,
        maxEntries: 1,
      }),
    ).rejects.toThrow('内置校验记录');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports unavailable assets without starting background installation', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 2,
            tiers: [
              {
                id: 'voice-runtime',
                version: '1.0.0',
                urls: ['https://assets.example.com/unapproved.zip'],
              },
            ],
          }),
        ),
    );
    const manager = new SpeechAssetManager(
      'unused-no-files-created',
      'https://assets.example.com/manifest.json',
      {
        fetch: fetcher,
        delay: async () => undefined,
        detectMetered: async () => false,
      },
    );
    await manager.scheduleInitialDownload();
    await expect(manager.getStatus()).resolves.toMatchObject({
      busy: false,
      tiers: [],
      message: expect.stringContaining('暂无可下载的已验证语音资源'),
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
