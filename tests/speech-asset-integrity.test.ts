import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SpeechAssetIntegrity } from '../src/main/speech/speech-asset-integrity';

const { anchors, disk } = vi.hoisted(() => ({
  anchors: {} as Record<string, SpeechAssetIntegrity | null>,
  disk: { available: 10_000_000_000 },
}));
vi.mock('../src/main/speech/speech-asset-integrity', () => ({ SPEECH_ASSET_INTEGRITY: anchors }));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  statfs: vi.fn(async () => ({ bsize: 1, bavail: disk.available })),
}));

import {
  parseSpeechAssetManifest,
  SpeechAssetDownloader,
} from '../src/main/speech/speech-asset-downloader';

const roots: string[] = [];
const archive = Buffer.from(
  zipSync({
    'models/sensevoice/model.int8.onnx': new TextEncoder().encode('fake model'),
    'models/sensevoice/tokens.txt': new TextEncoder().encode('fake tokens'),
  }),
);
const route = {
  id: 'speech-input',
  version: '1.0.0',
  urls: ['https://assets.example.com/input.zip'],
};
const root = async () => {
  const value = await mkdtemp(path.join(os.tmpdir(), 'fpnf-integrity-'));
  roots.push(value);
  return value;
};
const manifest = (tier: unknown = route) => ({ schemaVersion: 2, tiers: [tier] });
const resolved = () => parseSpeechAssetManifest(manifest()).tiers[0]!;

describe('application-owned speech asset integrity', () => {
  beforeEach(() => {
    anchors['voice-runtime'] = null;
    anchors['speech-input'] = {
      target: 'speech-input-runtime',
      version: '1.0.0',
      sha256: createHash('sha256').update(archive).digest('hex'),
      compressedBytes: archive.length,
      extractedBytes: 21,
      maxEntries: 2,
    };
    disk.available = 10_000_000_000;
  });
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
  });

  it('rejects checksum, size and target fields from a remote route', () => {
    for (const extra of [{ sha256: 'a'.repeat(64) }, { bytes: 1 }, { target: 'voice-runtime' }]) {
      expect(() => parseSpeechAssetManifest(manifest({ ...route, ...extra }))).toThrow();
    }
    expect(resolved()).toMatchObject({ bytes: archive.length, extractedBytes: 21, maxEntries: 2 });
  });

  it('rejects unknown ids and old schemas, and makes unpinned or mismatched tiers unavailable', () => {
    expect(() => parseSpeechAssetManifest(manifest({ ...route, id: 'voice-quality' }))).toThrow();
    expect(() => parseSpeechAssetManifest({ ...manifest(), schemaVersion: 1 })).toThrow();
    expect(parseSpeechAssetManifest(manifest({ ...route, version: '0.9.0' })).tiers).toEqual([]);
    expect(parseSpeechAssetManifest(manifest({ ...route, id: 'voice-runtime' })).tiers).toEqual([]);
  });

  it('refuses a replaced archive even when the install caller supplies its matching checksum', async () => {
    const destination = await root();
    const replacement = Buffer.from(archive);
    replacement[40] ^= 1;
    const fetcher = vi.fn(async () => new Response(replacement));
    const downloader = new SpeechAssetDownloader(destination, { fetch: fetcher });
    await expect(
      downloader.install({
        ...resolved(),
        sha256: createHash('sha256').update(replacement).digest('hex'),
        urls: [...route.urls, 'https://mirror.example.com/input.zip'],
      }),
    ).rejects.toThrow('SHA256');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await readdir(destination)).toEqual(['.downloads']);
    expect(await readdir(path.join(destination, '.downloads'))).toEqual([]);
  });

  it('installs the approved archive and ignores caller-supplied target and size', async () => {
    const destination = await root();
    const downloader = new SpeechAssetDownloader(destination, {
      fetch: vi.fn(async () => new Response(archive)),
    });
    await expect(
      downloader.install({ ...resolved(), bytes: 1, target: 'voice-runtime' }),
    ).resolves.toMatchObject({ state: 'ready' });
    expect(
      await readFile(
        path.join(destination, 'speech-input-runtime/models/sensevoice/tokens.txt'),
        'utf8',
      ),
    ).toBe('fake tokens');
  });

  it('stops before fetching when free disk space is insufficient', async () => {
    disk.available = 1;
    const fetcher = vi.fn(async () => new Response(archive));
    const downloader = new SpeechAssetDownloader(await root(), { fetch: fetcher });
    await expect(downloader.install(resolved())).rejects.toThrow('磁盘空间不足');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a resumed response whose total size disagrees with the compiled archive size', async () => {
    const destination = await root();
    await mkdir(path.join(destination, '.downloads'));
    await writeFile(
      path.join(destination, '.downloads', 'speech-input-1.0.0.zip.part'),
      archive.subarray(0, 10),
    );
    const fetcher = vi.fn(
      async () =>
        new Response(archive.subarray(10), {
          status: 206,
          headers: { 'content-range': `bytes 10-${archive.length - 1}/${archive.length + 1}` },
        }),
    );
    await expect(
      new SpeechAssetDownloader(destination, { fetch: fetcher }).install(resolved()),
    ).rejects.toThrow('分段');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['entries', 'bytes'])(
    'enforces compiled extraction limits (%s) and cleans staging',
    async (limit) => {
      const previous = anchors['speech-input']!;
      anchors['speech-input'] = {
        ...previous,
        ...(limit === 'entries' ? { maxEntries: 1 } : { extractedBytes: 1 }),
      };
      const destination = await root();
      const fetcher = vi.fn(async () => new Response(archive));
      await expect(
        new SpeechAssetDownloader(destination, { fetch: fetcher }).install(resolved()),
      ).rejects.toThrow(limit === 'entries' ? '文件数量' : '体积');
      expect(await readdir(destination)).toEqual(['.downloads']);
      expect(await readdir(path.join(destination, '.downloads'))).toEqual([]);
    },
  );

  it('fails safely after all mirrors are unavailable', async () => {
    const destination = await root();
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    await expect(
      new SpeechAssetDownloader(destination, { fetch: fetcher }).install({
        ...resolved(),
        urls: [...route.urls, 'https://mirror.example.com/input.zip'],
      }),
    ).rejects.toThrow('503');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await readdir(destination)).toEqual(['.downloads']);
  });
});
