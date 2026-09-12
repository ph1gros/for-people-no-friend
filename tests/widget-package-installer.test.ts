import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bytes } from './fixtures/widget-clock';

const diskFailure = vi.hoisted(() => ({ enabled: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (diskFailure.enabled) throw Object.assign(new Error('No space'), { code: 'ENOSPC' });
      return actual.writeFile(...args);
    },
  };
});
import { WidgetPackageInstaller } from '../src/main/widgets/widget-package-installer';
import { WidgetRuntime } from '../src/main/widgets/widget-runtime';

vi.mock('../src/main/widgets/widget-package-integrity', async () => {
  const fixture = await import('./fixtures/widget-clock');
  const { zipSync, strToU8 } = await import('fflate');
  const { createHash } = await import('node:crypto');
  const content = strToU8(
    JSON.stringify({
      ...fixture.manifest,
      capability: { ...fixture.manifest.capability, id: 'unsafe' },
    }),
  );
  const unsafe = zipSync(
    { 'manifest.json': content, 'evil.js': strToU8('bad') },
    { mtime: new Date(2020, 0, 1) },
  );
  return {
    WIDGET_PACKAGE_INTEGRITY: Object.freeze({
      clock: fixture.integrity,
      unsafe: {
        ...fixture.integrity,
        target: 'unsafe',
        sha256: createHash('sha256').update(unsafe).digest('hex'),
        compressedBytes: unsafe.length,
        extractedBytes: content.length + 3,
        maxEntries: 2,
      },
    }),
  };
});

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  diskFailure.enabled = false;
  vi.useRealTimers();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
    ),
  );
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const root = async () => {
  await mkdir(resolve('.release'), { recursive: true });
  const value = await mkdtemp(join(resolve('.release'), 'widget-test-'));
  roots.push(value);
  return value;
};
const serve = async (content: Uint8Array) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Length': content.length });
    response.end(content);
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  return `http://127.0.0.1:${address.port}/clock.zip`;
};
describe('trusted widget installation', () => {
  it('rejects executable content even when the approved hash matches', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    const { manifest } = await import('./fixtures/widget-clock');
    const content = strToU8(
      JSON.stringify({ ...manifest, capability: { ...manifest.capability, id: 'unsafe' } }),
    );
    const unsafe = zipSync(
      { 'manifest.json': content, 'evil.js': strToU8('bad') },
      { mtime: new Date(2020, 0, 1) },
    );
    const destination = await root();
    await expect(
      new WidgetPackageInstaller(destination, {
        fetch: async () => new Response(unsafe),
        detectMetered: async () => false,
      }).install({ id: 'unsafe', version: '1.0.0', urls: ['https://example.invalid/unsafe.zip'] }),
    ).rejects.toMatchObject({ rule: 1, file: 'evil.js' });
    expect(await readdir(destination)).toEqual([]);
  });
  it('honors explicit unknown-cost consent until an unmetered-to-metered transition', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const destination = await root();
    let signal: AbortSignal | undefined;
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((done) => {
      markStarted = done;
    });
    const fetcher: typeof fetch = async (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            signal?.addEventListener('abort', () => controller.error(signal?.reason), {
              once: true,
            });
            markStarted();
          },
        }),
      );
    };
    const cost = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const install = new WidgetPackageInstaller(destination, {
      fetch: fetcher,
      detectMetered: cost,
    }).install({ id: 'clock', version: '1.0.0', urls: ['https://example.invalid/clock.zip'] });
    const failure = expect(install).rejects.toThrow(/计费或未知/u);
    await started;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    await failure;
    expect(await readdir(destination)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans staging after a truncated transfer', async () => {
    const destination = await root();
    const fetcher: typeof fetch = async () => new Response(bytes.slice(0, 50));
    await expect(
      new WidgetPackageInstaller(destination, {
        fetch: fetcher,
        detectMetered: async () => undefined,
      }).install({ id: 'clock', version: '1.0.0', urls: ['https://example.invalid/clock.zip'] }),
    ).rejects.toThrow(/未完成/u);
    expect(await readdir(destination)).toEqual([]);
  });
  it('preserves the installed package when extraction runs out of disk space', async () => {
    const destination = await root();
    const url = await serve(bytes);
    const installer = new WidgetPackageInstaller(destination, {
      allowLocalhostHttp: true,
      detectMetered: async () => false,
    });
    await installer.install({ id: 'clock', version: '1.0.0', urls: [url] });
    diskFailure.enabled = true;
    await expect(
      installer.install({ id: 'clock', version: '1.0.0', urls: [url] }),
    ).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(await readdir(destination)).toEqual(['clock']);
    const runtime = new WidgetRuntime();
    await runtime.loadApprovedPackages(destination);
    expect(runtime.has('clock')).toBe(true);
  });
  it('downloads, validates and loads an approved clock via local HTTP', async () => {
    const destination = await root();
    await new WidgetPackageInstaller(destination, {
      allowLocalhostHttp: true,
      detectMetered: async () => false,
    }).install({
      id: 'clock',
      version: '1.0.0',
      urls: [await serve(bytes)],
    });
    const runtime = new WidgetRuntime();
    await runtime.loadApprovedPackages(destination);
    expect(runtime.knownIds()).toEqual(['input', 'media', 'clock']);
    expect(runtime.snapshots(['clock'], {})[0]).toMatchObject({
      enabled: true,
      available: true,
      values: { 'clock.time': expect.any(Number) },
    });
  });
  it('rejects a mismatched hash without leaving an installed directory', async () => {
    const destination = await root();
    const corrupt = bytes.slice();
    corrupt[50] ^= 1;
    await expect(
      new WidgetPackageInstaller(destination, {
        allowLocalhostHttp: true,
        detectMetered: async () => false,
      }).install({
        id: 'clock',
        version: '1.0.0',
        urls: [await serve(corrupt)],
      }),
    ).rejects.toThrow(/SHA256/u);
    expect(await readdir(destination)).toEqual([]);
  });
  it('rejects remote trust fields and unapproved IDs before requesting data', async () => {
    const installer = new WidgetPackageInstaller(await root());
    await expect(
      installer.install({
        id: 'clock',
        version: '1.0.0',
        urls: ['https://example.invalid/clock.zip'],
        sha256: 'fake',
      }),
    ).rejects.toThrow();
    await expect(
      installer.install({
        id: 'unknown',
        version: '1.0.0',
        urls: ['https://example.invalid/clock.zip'],
      }),
    ).rejects.toThrow();
  });
});
