import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ fault: '' as string, anchors: {} as Record<string, unknown> }));
vi.mock('../src/main/speech/speech-asset-integrity', () => ({
  SPEECH_ASSET_INTEGRITY: state.anchors,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    statfs: (...args: Parameters<typeof actual.statfs>) =>
      state.fault === 'preflight'
        ? Promise.resolve({ bavail: 0, bsize: 4096 })
        : actual.statfs(...args),
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (state.fault === 'write' && String(args[0]).endsWith('.zip.part'))
        handle.write = vi.fn(async () => {
          throw Object.assign(new Error('test ENOSPC'), { code: 'ENOSPC' });
        }) as typeof handle.write;
      return handle;
    },
  };
});
import {
  parseSpeechAssetManifest,
  SpeechAssetDownloader,
} from '../src/main/speech/speech-asset-downloader';
const roots: string[] = [];
const setup = async () => {
  const parent = path.resolve('.release/test-disk-failure');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'case-'));
  roots.push(root);
  await mkdir(path.join(root, 'voice-runtime'), { recursive: true });
  await writeFile(path.join(root, 'voice-runtime', 'old.txt'), 'existing resource');
  const archive = zipSync({
    'python/python.exe': new TextEncoder().encode('test only'),
    'ireina_tts_service.py': new TextEncoder().encode('fixture'),
  });
  state.anchors['voice-runtime'] = {
    version: '1.0.0',
    target: 'voice-runtime',
    compressedBytes: archive.length,
    extractedBytes: 100,
    maxEntries: 2,
    sha256: createHash('sha256').update(archive).digest('hex'),
  };
  const tier = parseSpeechAssetManifest({
    schemaVersion: 2,
    tiers: [{ id: 'voice-runtime', version: '1.0.0', urls: ['https://example.com/test.zip'] }],
  }).tiers[0]!;
  const fetcher = vi.fn(
    async () => new Response(archive, { headers: { 'content-length': String(archive.length) } }),
  );
  return { root, tier, fetcher, downloader: new SpeechAssetDownloader(root, { fetch: fetcher }) };
};
describe('download disk failure boundaries', () => {
  afterEach(async () => {
    state.fault = '';
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });
  it('rejects inadequate disk space before contacting any download server', async () => {
    const { downloader, tier, fetcher } = await setup();
    state.fault = 'preflight';
    await expect(downloader.install(tier)).rejects.toThrow('磁盘空间不足');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reports a mid-write ENOSPC in Chinese and preserves the existing target', async () => {
    const { downloader, tier, root } = await setup();
    state.fault = 'write';
    await expect(downloader.install(tier)).rejects.toThrow('磁盘空间已用尽');
    await expect(readFile(path.join(root, 'voice-runtime', 'old.txt'), 'utf8')).resolves.toBe(
      'existing resource',
    );
  });
});
