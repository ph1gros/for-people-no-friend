import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { zipSync } from 'fflate';
import { expect, it, vi } from 'vitest';
import { ResourceCenter } from '../src/main/resources/resource-center';
import { SpeechAssetManager } from '../src/main/speech/speech-asset-manager';
import { BUNDLED_RESOURCE_CATALOG } from '../src/shared/resource-catalog';
import type { SpeechAssetIntegrity } from '../src/main/speech/speech-asset-integrity';

const { pins } = vi.hoisted(() => ({
  pins: { 'voice-runtime': null, 'speech-input': null as SpeechAssetIntegrity | null },
}));
vi.mock('../src/main/speech/speech-asset-integrity', () => ({ SPEECH_ASSET_INTEGRITY: pins }));

it('downloads only on request, resumes a real local transfer and discovers installed assets offline', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fpnf-resource-e2e-'));
  const model = randomBytes(128 * 1024);
  const archive = Buffer.from(
    zipSync({
      'models/sensevoice/model.int8.onnx': model,
      'models/sensevoice/tokens.txt': new TextEncoder().encode('fake-token'),
    }),
  );
  pins['speech-input'] = {
    version: '1.0.0',
    target: 'speech-input-runtime',
    sha256: createHash('sha256').update(archive).digest('hex'),
    compressedBytes: archive.length,
    extractedBytes: model.length + 10,
    maxEntries: 2,
  };
  const ranges: string[] = [];
  let address = '';
  const server = createServer((req, res) => {
    if (req.url === '/catalog.json') {
      res.end(JSON.stringify(BUNDLED_RESOURCE_CATALOG));
      return;
    }
    if (req.url === '/manifest.json') {
      res.end(
        JSON.stringify({
          schemaVersion: 2,
          tiers: [{ id: 'speech-input', version: '1.0.0', urls: [`${address}/package.zip`] }],
        }),
      );
      return;
    }
    if (req.url !== '/package.zip') {
      res.writeHead(404).end();
      return;
    }
    const range = req.headers.range ?? '';
    ranges.push(range);
    let offset = Number(/^bytes=(\d+)-/u.exec(range)?.[1] ?? 0);
    res.writeHead(offset ? 206 : 200, {
      'Content-Length': archive.length - offset,
      ...(offset
        ? { 'Content-Range': `bytes ${offset}-${archive.length - 1}/${archive.length}` }
        : {}),
    });
    const timer = setInterval(() => {
      const end = Math.min(offset + 4096, archive.length);
      res.write(archive.subarray(offset, end));
      offset = end;
      if (offset === archive.length) {
        clearInterval(timer);
        res.end();
      }
    }, 5);
    res.on('close', () => clearInterval(timer));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let pausedOnce = false;
  const manager = new SpeechAssetManager(root, `${address}/manifest.json`, {
    allowLocalhostHttp: true,
    detectMetered: async () => false,
    notify: (status) => {
      if (
        !pausedOnce &&
        status.tiers.some((tier) => tier.state === 'downloading' && tier.downloadedBytes >= 8192)
      ) {
        pausedOnce = true;
        void manager.control({ tierId: 'speech-input', action: 'pause' });
      }
    },
  });
  const center = new ResourceCenter(manager, `${address}/catalog.json`, {
    allowLocalhostHttp: true,
  });
  const offline = new SpeechAssetManager(root, undefined);
  const offlineCenter = new ResourceCenter(offline);
  try {
    await manager.initialize();
    expect((await center.getStatus()).downloads.tiers[0]?.state).toBe('pending');
    await center.refresh();
    expect(ranges).toHaveLength(0);
    await manager.control({ tierId: 'speech-input', action: 'start' });
    await vi.waitFor(
      async () =>
        expect(await manager.getStatus()).toMatchObject({
          busy: false,
          tiers: [{ state: 'paused' }],
        }),
      { timeout: 5000 },
    );
    await manager.control({ tierId: 'speech-input', action: 'resume' });
    await vi.waitFor(
      async () =>
        expect(await manager.getStatus()).toMatchObject({
          busy: false,
          tiers: [{ state: 'ready' }],
        }),
      { timeout: 5000 },
    );
    expect(ranges.some((range) => /^bytes=[1-9]\d*-/u.test(range))).toBe(true);
    expect(
      await readFile(path.join(root, 'speech-input-runtime/models/sensevoice/model.int8.onnx')),
    ).toEqual(model);
    expect((await offlineCenter.getStatus()).downloads).toMatchObject({
      sourceConfigured: false,
      tiers: [{ state: 'ready' }],
    });
  } finally {
    center.dispose();
    offlineCenter.dispose();
    manager.dispose();
    offline.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
    pins['speech-input'] = null;
  }
}, 15000);
