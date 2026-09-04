import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LocalSherpaAsrAdapter,
  normalizeSherpaModule,
  parsePcm16Wave,
  resolveLocalSherpaModelRoots,
} from '../src/adapters/speech/local-sherpa-asr';

const directories: string[] = [];

const createModelRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fpnf-local-asr-'));
  directories.push(root);
  await writeFile(path.join(root, 'model.int8.onnx'), 'fake model');
  await writeFile(path.join(root, 'tokens.txt'), 'fake tokens');
  return root;
};

const pcm16Wave = (samples: readonly number[], sampleRate = 16_000): Uint8Array => {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, 44 + index * 2));
  return buffer;
};

describe('local sherpa ASR adapter', () => {
  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it('normalizes the CommonJS addon exposed through an ESM default export', () => {
    const createAsync = vi.fn();
    expect(
      normalizeSherpaModule({ default: { OfflineRecognizer: { createAsync } } }),
    ).toMatchObject({ OfflineRecognizer: { createAsync } });
    expect(() => normalizeSherpaModule({})).toThrow('无法加载');
  });

  it('resolves only the packaged root in production and explicit roots in development', () => {
    expect(
      resolveLocalSherpaModelRoots({
        appPath: 'C:\\workspace',
        resourcesPath: 'C:\\resources',
        userDataPath: 'C:\\user-data',
        packaged: true,
      }),
    ).toEqual([
      'C:\\user-data\\speech-assets\\speech-input-runtime\\models\\sensevoice',
      'C:\\resources\\speech-input-runtime\\models\\sensevoice',
    ]);
    expect(
      resolveLocalSherpaModelRoots({
        appPath: 'C:\\workspace',
        resourcesPath: 'C:\\resources',
        userDataPath: 'C:\\user-data',
        packaged: false,
      }),
    ).toEqual([
      'C:\\user-data\\speech-assets\\speech-input-runtime\\models\\sensevoice',
      'C:\\resources\\speech-input-runtime\\models\\sensevoice',
      'C:\\workspace\\data\\sensevoice-sherpa-runtime\\models\\sensevoice',
    ]);
  });

  it('parses the renderer PCM WAV into bounded float samples', () => {
    const wave = parsePcm16Wave(pcm16Wave([-32_768, 0, 16_384, 32_767]));
    expect(wave.sampleRate).toBe(16_000);
    expect([...wave.samples]).toEqual([-1, 0, 0.5, 32_767 / 32_768]);
    expect(() => parsePcm16Wave(new Uint8Array([82, 73, 70, 70]))).toThrow('WAV');
    expect(() => parsePcm16Wave(pcm16Wave([1], 44_100))).toThrow('16 kHz');
  });

  it('validates assets, lazily creates one recognizer per language, and reuses it', async () => {
    const root = await createModelRoot();
    const decodeAsync = vi.fn(async () => ({ text: '你好。' }));
    const acceptWaveform = vi.fn();
    const createStream = vi.fn(() => ({ acceptWaveform }));
    const createAsync = vi.fn(async () => ({ createStream, decodeAsync }));
    const adapter = new LocalSherpaAsrAdapter([root], async () => ({
      OfflineRecognizer: { createAsync },
    }));

    await expect(adapter.isAvailable()).resolves.toBe(true);
    for (let index = 0; index < 20; index += 1) {
      await expect(
        adapter.transcribe(
          {
            requestId: `request-${index}`,
            audio: pcm16Wave([0, 100, -100]),
            mimeType: 'audio/wav',
            modelId: 'SenseVoiceSmall',
            language: 'zh-CN',
          },
          new AbortController().signal,
        ),
      ).resolves.toEqual({ text: '你好。' });
    }

    expect(createAsync).toHaveBeenCalledOnce();
    expect(createStream).toHaveBeenCalledTimes(20);
    expect(acceptWaveform).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: 16_000, samples: expect.any(Float32Array) }),
    );
    adapter.dispose();
  });

  it('stays unavailable when assets are missing and honors cancellation', async () => {
    const missingRoot = await mkdtemp(path.join(os.tmpdir(), 'fpnf-local-asr-missing-'));
    directories.push(missingRoot);
    const adapter = new LocalSherpaAsrAdapter([missingRoot], async () => ({
      OfflineRecognizer: { createAsync: vi.fn() },
    }));
    await expect(adapter.isAvailable()).resolves.toBe(false);

    const root = await createModelRoot();
    const available = new LocalSherpaAsrAdapter([root], async () => ({
      OfflineRecognizer: {
        createAsync: async () => ({
          createStream: () => ({ acceptWaveform: () => undefined }),
          decodeAsync: async () => ({ text: '不应返回' }),
        }),
      },
    }));
    const controller = new AbortController();
    controller.abort();
    await expect(
      available.transcribe(
        {
          requestId: 'cancelled',
          audio: pcm16Wave([0]),
          mimeType: 'audio/wav',
          modelId: 'SenseVoiceSmall',
          language: 'zh-CN',
        },
        controller.signal,
      ),
    ).rejects.toThrow('已取消');
  });
});
