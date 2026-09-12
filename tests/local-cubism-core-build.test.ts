import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { build, createServer, resolveConfig } from 'vite';

import { localCubismCorePlugin } from '../scripts/local-cubism-core-plugin';

const roots: string[] = [];
const fixture = async () => {
  await mkdir('.release/test-local-core', { recursive: true });
  const root = await mkdtemp(path.resolve('.release/test-local-core/run-'));
  roots.push(root);
  const source = path.join(root, 'private-assets/live2dcubismcore.min.js');
  await mkdir(path.dirname(source));
  const core = 'globalThis.Live2DCubismCore = { fixture: true };';
  await writeFile(source, core);
  await writeFile(path.join(path.dirname(source), 'private-model.moc3'), 'never-copy');
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Fixture</title>');
  return { root, source, core, sha256: createHash('sha256').update(core).digest('hex') };
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('explicit local Cubism Core build', () => {
  it('keeps the real default build free of Core and requires the explicit local mode', async () => {
    for (const mode of ['production', 'development', 'local-core']) {
      const config = await resolveConfig({ mode, logLevel: 'silent' }, 'build');
      // Vite normalizes a disabled public directory to an empty resolved path.
      expect(config.publicDir).toBe('');
      expect(config.plugins.some((plugin) => plugin.name === 'fpnf-local-cubism-core')).toBe(
        mode === 'local-core',
      );
    }
  });

  it('emits only the checked runtime at the application path', async () => {
    const input = await fixture();
    await build({
      configFile: false,
      root: input.root,
      publicDir: false,
      logLevel: 'silent',
      plugins: [localCubismCorePlugin({ sourcePath: input.source, sha256: input.sha256 })],
    });
    await expect(
      readFile(path.join(input.root, 'dist/runtime/cubism/live2dcubismcore.min.js'), 'utf8'),
    ).resolves.toBe(input.core);
    const output = path.join(input.root, 'dist');
    const entries = await readdir(output, { recursive: true, withFileTypes: true });
    expect(
      entries
        .filter((entry) => entry.isFile())
        .map((entry) =>
          path.relative(output, path.join(entry.parentPath, entry.name)).replaceAll('\\', '/'),
        )
        .sort(),
    ).toEqual(['index.html', 'runtime/cubism/live2dcubismcore.min.js']);
  });

  it('serves the same checked bytes on the local development runtime route', async () => {
    const input = await fixture();
    const server = await createServer({
      configFile: false,
      root: input.root,
      publicDir: false,
      logLevel: 'silent',
      plugins: [localCubismCorePlugin({ sourcePath: input.source, sha256: input.sha256 })],
      server: { host: '127.0.0.1', port: 0 },
    });
    try {
      await server.listen();
      const address = server.httpServer!.address();
      if (!address || typeof address === 'string') throw new Error('Missing local test address');
      const response = await fetch(
        `http://127.0.0.1:${address.port}/runtime/cubism/live2dcubismcore.min.js`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/javascript');
      expect(await response.text()).toBe(input.core);
    } finally {
      await server.close();
    }
  });

  it('fails before emitting a runtime when the local file changed', async () => {
    const input = await fixture();
    await writeFile(input.source, `${input.core} /* changed */`);
    await expect(
      build({
        configFile: false,
        root: input.root,
        publicDir: false,
        logLevel: 'silent',
        plugins: [localCubismCorePlugin({ sourcePath: input.source, sha256: input.sha256 })],
      }),
    ).rejects.toThrow('Core');
    await expect(
      readFile(path.join(input.root, 'dist/runtime/cubism/live2dcubismcore.min.js')),
    ).rejects.toThrow();
  });

  it('reports a missing local runtime rather than producing an apparently usable build', async () => {
    const input = await fixture();
    await rm(input.source);
    await expect(
      build({
        configFile: false,
        root: input.root,
        publicDir: false,
        logLevel: 'silent',
        plugins: [localCubismCorePlugin({ sourcePath: input.source, sha256: input.sha256 })],
      }),
    ).rejects.toThrow('Core');
  });
});
