import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { zipSync } from 'fflate';
import { expect, it, vi } from 'vitest';
import type { SpeechAssetIntegrity } from '../src/main/speech/speech-asset-integrity';
const { pins } = vi.hoisted(() => ({ pins: {} as Record<string, SpeechAssetIntegrity | null> }));
vi.mock('../src/main/speech/speech-asset-integrity', () => ({ SPEECH_ASSET_INTEGRITY: pins }));
import {
  SpeechAssetDownloader,
  parseSpeechAssetManifest,
} from '../src/main/speech/speech-asset-downloader';
import { BundledSpeechRuntime } from '../src/main/speech/bundled-speech-runtime';

it('installs engine, BERT and Ireina separately, and requires all three activation records to start', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fpnf-separated-assets-'));
  const assets = [
    {
      id: 'voice-runtime',
      target: 'voice-runtime',
      files: ['python/python.exe', 'ireina_tts_service.py'],
    },
    {
      id: 'bert-japanese',
      target: 'bert-japanese',
      files: ['model_fp16.onnx', 'config.json', 'tokenizer.json'],
    },
    {
      id: 'voice-ireina',
      target: 'voice-ireina',
      files: ['ireina_e100_s16040.onnx', 'config.json', 'style_vectors.npy', 'LICENSE.txt'],
    },
  ] as const;
  const runtime = new BundledSpeechRuntime({
    runtimeRoot: path.join(root, 'voice-runtime'),
    downloadedAsset: true,
  });
  try {
    for (const asset of assets) {
      const archive = Buffer.from(
        zipSync(
          Object.fromEntries(asset.files.map((name) => [name, new TextEncoder().encode('fake')])),
        ),
      );
      pins[asset.id] = {
        version: '1.0.0',
        target: asset.target,
        sha256: createHash('sha256').update(archive).digest('hex'),
        compressedBytes: archive.length,
        extractedBytes: asset.files.length * 4,
        maxEntries: asset.files.length,
      };
      const tier = parseSpeechAssetManifest({
        schemaVersion: 2,
        tiers: [{ id: asset.id, version: '1.0.0', urls: ['https://example.com/fake.zip'] }],
      }).tiers[0]!;
      await new SpeechAssetDownloader(root, {
        fetch: vi.fn(async () => new Response(archive)),
      }).install(tier);
      if (asset.id !== 'voice-ireina') expect(await runtime.resolveAvailableRoot()).toBeUndefined();
    }
    expect(await runtime.resolveAvailableRoot()).toBeTruthy();
    await rm(path.join(root, 'active', 'voice-ireina.json'));
    expect(await runtime.resolveAvailableRoot()).toBeUndefined();
    // A bundled-looking copy under the engine cannot replace a missing voice receipt.
    await mkdir(path.join(root, 'voice-runtime', 'voice', 'ireina'), { recursive: true });
    for (const name of assets[2].files)
      await writeFile(path.join(root, 'voice-runtime', 'voice', 'ireina', name), 'fake');
    expect(await runtime.resolveAvailableRoot()).toBeUndefined();
  } finally {
    runtime.dispose();
    await rm(root, { recursive: true, force: true });
    for (const asset of assets) pins[asset.id] = null;
  }
});
