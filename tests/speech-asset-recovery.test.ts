import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupOrphanedSpeechAssetWorkspaces } from '../src/main/speech/speech-asset-downloader';
import { SpeechAssetManager } from '../src/main/speech/speech-asset-manager';

vi.mock('../src/main/speech/speech-asset-integrity', () => ({
  SPEECH_ASSET_INTEGRITY: {
    'voice-runtime': {
      version: '1.0.0',
      target: 'voice-runtime',
      sha256: 'a'.repeat(64),
      compressedBytes: 240,
      extractedBytes: 1000,
      maxEntries: 20,
    },
    'speech-input': {
      version: '1.0.0',
      target: 'speech-input-runtime',
      sha256: 'b'.repeat(64),
      compressedBytes: 225,
      extractedBytes: 1000,
      maxEntries: 20,
    },
  },
}));

const roots: string[] = [];

const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fpnf-speech-recovery-'));
  roots.push(root);
  return root;
};

const manifestBody = JSON.stringify({
  schemaVersion: 2,
  tiers: [
    {
      id: 'voice-runtime',
      version: '1.0.0',
      urls: ['https://downloads.example.com/voice.zip'],
    },
  ],
});

describe('speech asset crash recovery', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('reclaims staging and backup trees a hard kill left behind', async () => {
    const root = await makeRoot();
    const staging = '.staging-voice-runtime-00000000-0000-4000-8000-000000000001';
    const backup = '.backup-speech-input-runtime-00000000-0000-4000-8000-000000000002';
    await mkdir(path.join(root, staging, 'python'), { recursive: true });
    await writeFile(path.join(root, staging, 'python', 'x.bin'), 'x');
    await mkdir(path.join(root, backup), { recursive: true });
    await mkdir(path.join(root, '.downloads'), { recursive: true });
    await writeFile(path.join(root, '.downloads', 'voice-runtime-1.0.0.zip.part'), 'partial');
    await mkdir(path.join(root, 'voice-runtime'), { recursive: true });
    await mkdir(path.join(root, 'active'), { recursive: true });
    await mkdir(path.join(root, 'speech-input-runtime', 'models', 'sensevoice'), {
      recursive: true,
    });
    for (const name of ['model.int8.onnx', 'tokens.txt']) {
      await writeFile(
        path.join(root, 'speech-input-runtime', 'models', 'sensevoice', name),
        'fake',
      );
    }
    await writeFile(
      path.join(root, 'active', 'speech-input.json'),
      JSON.stringify({
        schemaVersion: 2,
        version: '1.0.0',
        sha256: 'b'.repeat(64),
      }),
    );

    await expect(cleanupOrphanedSpeechAssetWorkspaces(root)).resolves.toBe(2);

    const remaining = (await readdir(root)).sort();
    expect(remaining).toEqual(['.downloads', 'active', 'speech-input-runtime', 'voice-runtime']);
  });

  it('keeps a resumable partial download intact', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, '.downloads', 'voice-runtime-1.0.0.parts'), { recursive: true });
    await writeFile(path.join(root, '.downloads', 'voice-runtime-1.0.0.parts', '0.part'), 'abc');

    await expect(cleanupOrphanedSpeechAssetWorkspaces(root)).resolves.toBe(0);
    await expect(
      readdir(path.join(root, '.downloads', 'voice-runtime-1.0.0.parts')),
    ).resolves.toEqual(['0.part']);
  });

  it('tolerates a missing asset root', async () => {
    await expect(
      cleanupOrphanedSpeechAssetWorkspaces(path.join(await makeRoot(), 'never-created')),
    ).resolves.toBe(0);
  });

  it('cleans orphans even when no download source is configured', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, '.staging-voice-runtime-00000000-0000-4000-8000-000000000001'), {
      recursive: true,
    });
    const manager = new SpeechAssetManager(root, undefined, { delay: async () => undefined });

    await manager.scheduleInitialDownload();

    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('retries a manifest fetch that failed while the network was still coming up', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND downloads.example.com'))
      .mockResolvedValueOnce(
        new Response(manifestBody, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const manager = new SpeechAssetManager(
      await makeRoot(),
      'https://downloads.example.com/manifest.json',
      { fetch: fetcher },
    );

    const failed = await manager.getStatus();
    expect(failed.tiers).toEqual([]);
    expect(failed.message).toBeTruthy();

    const recovered = await manager.getStatus();
    expect(recovered.tiers).toEqual([
      expect.objectContaining({ id: 'voice-runtime', state: 'pending' }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(recovered.message).toBeUndefined();
  });

  it('preserves a backup that may be the only surviving installed copy', async () => {
    const root = await makeRoot();
    const backup = '.backup-voice-runtime-00000000-0000-4000-8000-000000000001';
    await mkdir(path.join(root, backup));
    await writeFile(path.join(root, backup, 'keep.bin'), 'previous installation');
    await expect(cleanupOrphanedSpeechAssetWorkspaces(root)).resolves.toBe(0);
    expect(await readdir(root)).toContain(backup);
  });

  it('leaves unrelated directories with a similar prefix alone', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, '.staging-not-a-speech-asset'));
    await expect(cleanupOrphanedSpeechAssetWorkspaces(root)).resolves.toBe(0);
    expect(await readdir(root)).toContain('.staging-not-a-speech-asset');
  });
});
