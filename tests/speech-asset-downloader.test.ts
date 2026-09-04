import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SpeechAssetIntegrity } from '../src/main/speech/speech-asset-integrity';
const anchors = vi.hoisted(() => ({}) as Record<string, SpeechAssetIntegrity | null>);
vi.mock('../src/main/speech/speech-asset-integrity', () => ({ SPEECH_ASSET_INTEGRITY: anchors }));

import {
  parseSpeechAssetManifest,
  SpeechAssetDownloader,
} from '../src/main/speech/speech-asset-downloader';

const roots: string[] = [];
const servers: Server[] = [];

const trustTestArchive = (
  archive: Buffer,
  sha256 = createHash('sha256').update(archive).digest('hex'),
) => {
  const files = Object.values(unzipSync(archive));
  anchors['voice-runtime'] = {
    version: '1.0.0',
    target: 'voice-runtime',
    sha256,
    compressedBytes: archive.length,
    extractedBytes: files.reduce((total, value) => total + value.length, 0),
    maxEntries: files.length,
  };
};
const testTier = (urls: string[]) =>
  parseSpeechAssetManifest(
    {
      schemaVersion: 2,
      tiers: [{ id: 'voice-runtime', version: '1.0.0', urls }],
    },
    { allowLocalhostHttp: true },
  ).tiers[0]!;

const listen = async (server: Server): Promise<number> =>
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') reject(new Error('Missing server address.'));
      else resolve(address.port);
    });
  });

const close = async (server: Server): Promise<void> =>
  await new Promise((resolve) => server.close(() => resolve()));

describe('speech asset downloader', () => {
  beforeEach(() => {
    anchors['voice-runtime'] = {
      version: '1.0.0',
      target: 'voice-runtime',
      sha256: 'a'.repeat(64),
      compressedBytes: 4,
      extractedBytes: 4,
      maxEntries: 1,
    };
    anchors['speech-input'] = {
      version: '1.0.0',
      target: 'speech-input-runtime',
      sha256: 'c'.repeat(64),
      compressedBytes: 4,
      extractedBytes: 4,
      maxEntries: 1,
    };
  });
  it('rejects a remote manifest that authorizes both replacement code and its checksum', () => {
    expect(() =>
      parseSpeechAssetManifest({
        schemaVersion: 1,
        tiers: [
          {
            id: 'voice-runtime',
            version: '1.0.0',
            target: 'voice-runtime',
            bytes: 4,
            sha256: 'a'.repeat(64),
            urls: ['https://downloads.example.com/replacement.zip'],
          },
        ],
      }),
    ).toThrow();
  });
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('strictly parses a two-tier URL manifest and rejects unsafe URLs', () => {
    const tiers = [
      { id: 'voice-runtime', version: '1.0.0', urls: ['https://downloads.example.com/voice.zip'] },
      { id: 'speech-input', version: '1.0.0', urls: ['https://downloads.example.com/input.zip'] },
    ];
    expect(parseSpeechAssetManifest({ schemaVersion: 2, tiers }).tiers.map(({ id }) => id)).toEqual(
      ['voice-runtime', 'speech-input'],
    );
    for (const url of [
      'http://evil.example.com/file.zip',
      'https://user:pass@example.com/file.zip',
      'https://example.com/file.zip#fragment',
    ]) {
      expect(() =>
        parseSpeechAssetManifest({ schemaVersion: 2, tiers: [{ ...tiers[0], urls: [url] }] }),
      ).toThrow();
    }
    expect(() =>
      parseSpeechAssetManifest({ schemaVersion: 2, tiers: [tiers[0], tiers[0]] }),
    ).toThrow('重复档位');
    expect(() => testTier(['https://example.com/a.zip', 'https://example.com/a.zip'])).toThrow(
      '重复下载地址',
    );
  });

  it('resumes a partial local HTTP download, verifies SHA256, and activates atomically', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fpnf-speech-assets-'));
    roots.push(root);
    const archive = Buffer.from(
      zipSync({
        'python/python.exe': new TextEncoder().encode('embedded python'),
        'ireina_tts_service.py': new TextEncoder().encode('service'),
        'python/Lib/site-packages/bert/deberta-v2-large-japanese-char-wwm-onnx/model_fp16.onnx':
          new TextEncoder().encode('bert'),
        'python/Lib/site-packages/bert/deberta-v2-large-japanese-char-wwm-onnx/config.json':
          new TextEncoder().encode('{}'),
        'python/Lib/site-packages/bert/deberta-v2-large-japanese-char-wwm-onnx/tokenizer.json':
          new TextEncoder().encode('{}'),
        'voice/ireina/ireina_e100_s16040.onnx': new TextEncoder().encode('voice'),
        'voice/ireina/config.json': new TextEncoder().encode('{}'),
        'voice/ireina/style_vectors.npy': new TextEncoder().encode('styles'),
      }),
    );
    let firstRequest = true;
    const server = createServer((request, response) => {
      const range = request.headers.range;
      const start = range ? Number(/^bytes=(\d+)-$/u.exec(range)?.[1] ?? 0) : 0;
      if (!range && firstRequest) {
        firstRequest = false;
        response.writeHead(200, { 'content-length': archive.length, 'accept-ranges': 'bytes' });
        response.flushHeaders();
        response.write(archive.subarray(0, Math.floor(archive.length / 2)));
        setTimeout(() => response.destroy(), 20);
        return;
      }
      response.writeHead(start > 0 ? 206 : 200, {
        'content-length': archive.length - start,
        'content-range': `bytes ${start}-${archive.length - 1}/${archive.length}`,
        'accept-ranges': 'bytes',
      });
      response.end(archive.subarray(start));
    });
    servers.push(server);
    const port = await listen(server);
    trustTestArchive(archive);
    const tier = testTier([`http://127.0.0.1:${port}/voice.zip`]);
    const downloader = new SpeechAssetDownloader(root, { allowLocalhostHttp: true });

    await expect(downloader.install(tier)).rejects.toThrow();
    const partialPath = path.join(root, '.downloads', 'voice-runtime-1.0.0.zip.part');
    expect((await stat(partialPath)).size).toBeGreaterThan(0);
    await expect(downloader.install(tier)).resolves.toMatchObject({
      id: 'voice-runtime',
      state: 'ready',
    });
    await expect(
      readFile(path.join(root, 'voice-runtime', 'python', 'python.exe'), 'utf8'),
    ).resolves.toBe('embedded python');
    await expect(
      readFile(path.join(root, 'active', 'voice-runtime.json'), 'utf8'),
    ).resolves.toContain('1.0.0');
  });

  it('downloads a large archive in four resumable range segments', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fpnf-speech-assets-segmented-'));
    roots.push(root);
    const archive = Buffer.from(
      zipSync(
        {
          'python/python.exe': new Uint8Array(1_200_000),
          'ireina_tts_service.py': new TextEncoder().encode('service'),
          'python/Lib/site-packages/bert/deberta-v2-large-japanese-char-wwm-onnx/model_fp16.onnx':
            new TextEncoder().encode('bert'),
          'python/Lib/site-packages/bert/deberta-v2-large-japanese-char-wwm-onnx/config.json':
            new TextEncoder().encode('{}'),
          'python/Lib/site-packages/bert/deberta-v2-large-japanese-char-wwm-onnx/tokenizer.json':
            new TextEncoder().encode('{}'),
          'voice/ireina/ireina_e100_s16040.onnx': new TextEncoder().encode('voice'),
          'voice/ireina/config.json': new TextEncoder().encode('{}'),
          'voice/ireina/style_vectors.npy': new TextEncoder().encode('styles'),
        },
        { level: 0 },
      ),
    );
    const ranges: string[] = [];
    const server = createServer((request, response) => {
      const range = request.headers.range;
      const match = range ? /^bytes=(\d+)-(\d+)$/u.exec(range) : undefined;
      if (!range || !match) {
        response.writeHead(416).end();
        return;
      }
      ranges.push(range);
      const start = Number(match[1]);
      const end = Number(match[2]);
      response.writeHead(206, {
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${archive.length}`,
      });
      response.end(archive.subarray(start, end + 1));
    });
    servers.push(server);
    const port = await listen(server);
    trustTestArchive(archive);
    const tier = testTier([`http://127.0.0.1:${port}/voice.zip`]);
    const downloader = new SpeechAssetDownloader(root, {
      allowLocalhostHttp: true,
      segmentCount: 4,
    });

    await expect(downloader.install(tier)).resolves.toMatchObject({ state: 'ready' });
    expect(ranges).toHaveLength(4);
    expect(new Set(ranges).size).toBe(4);
  });

  it('deletes a corrupt archive and rejects zip-slip entries', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fpnf-speech-assets-corrupt-'));
    roots.push(root);
    const archive = Buffer.from(zipSync({ '../escape.txt': new TextEncoder().encode('no') }));
    const server = createServer((_request, response) => response.end(archive));
    servers.push(server);
    const port = await listen(server);
    trustTestArchive(archive, '0'.repeat(64));
    const base = testTier([`http://127.0.0.1:${port}/voice.zip`]);
    const downloader = new SpeechAssetDownloader(root, { allowLocalhostHttp: true });

    await expect(downloader.install({ ...base, sha256: '0'.repeat(64) })).rejects.toThrow('SHA256');
    await expect(
      stat(path.join(root, '.downloads', 'voice-runtime-1.0.0.zip.part')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    trustTestArchive(archive);
    await expect(downloader.install(base)).rejects.toThrow('不安全');
    await expect(stat(path.join(root, 'escape.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('pauses without deleting progress and cancel removes the partial download', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'fpnf-speech-assets-pause-'));
    roots.push(root);
    const archive = Buffer.from(
      zipSync(
        {
          'python/python.exe': new Uint8Array(128 * 1024),
          'ireina_tts_service.py': new TextEncoder().encode('service'),
          'python/Lib/site-packages/bert/deberta-v2-large-japanese-char-wwm-onnx/model_fp16.onnx':
            new TextEncoder().encode('bert'),
          'python/Lib/site-packages/bert/deberta-v2-large-japanese-char-wwm-onnx/config.json':
            new TextEncoder().encode('{}'),
          'python/Lib/site-packages/bert/deberta-v2-large-japanese-char-wwm-onnx/tokenizer.json':
            new TextEncoder().encode('{}'),
          'voice/ireina/ireina_e100_s16040.onnx': new TextEncoder().encode('voice'),
          'voice/ireina/config.json': new TextEncoder().encode('{}'),
          'voice/ireina/style_vectors.npy': new TextEncoder().encode('styles'),
        },
        { level: 0 },
      ),
    );
    const server = createServer((request, response) => {
      const start = Number(/^bytes=(\d+)-$/u.exec(request.headers.range ?? '')?.[1] ?? 0);
      response.writeHead(start > 0 ? 206 : 200, {
        'content-length': archive.length - start,
        'content-range': `bytes ${start}-${archive.length - 1}/${archive.length}`,
      });
      let offset = start;
      const timer = setInterval(() => {
        if (offset >= archive.length || response.destroyed) {
          clearInterval(timer);
          if (!response.destroyed) response.end();
          return;
        }
        const end = Math.min(offset + 4_096, archive.length);
        response.write(archive.subarray(offset, end));
        offset = end;
      }, 2);
    });
    servers.push(server);
    const port = await listen(server);
    trustTestArchive(archive);
    const tier = testTier([`http://127.0.0.1:${port}/voice.zip`]);
    const downloader = new SpeechAssetDownloader(root, {
      allowLocalhostHttp: true,
      onProgress: ({ downloadedBytes }) => {
        if (downloadedBytes > 0) downloader.pause('voice-runtime');
      },
    });

    await expect(downloader.install(tier)).resolves.toMatchObject({ state: 'paused' });
    const partialPath = path.join(root, '.downloads', 'voice-runtime-1.0.0.zip.part');
    expect((await stat(partialPath)).size).toBeGreaterThan(0);
    await downloader.cancel('voice-runtime', '1.0.0');
    await expect(stat(partialPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
