import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const listFiles = async (root: string, relative = ''): Promise<string[]> => {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const next = path.join(relative, entry.name);
        return entry.isDirectory() ? listFiles(root, next) : Promise.resolve([next]);
      }),
    )
  ).flat();
};

describe('renderer asset build policy', () => {
  it('builds the deskpet, resource centre and setup pages together', async () => {
    for (const page of ['index.html', 'resource-center.html', 'setup/index.html']) {
      const html = await readFile(path.resolve('dist/renderer', page), 'utf8');
      expect(html).toContain('<!doctype html>');
      expect(html).not.toContain('ws://127.0.0.1:5173');
    }
  });

  it('disables the broad assets public directory', async () => {
    const source = await readFile(path.resolve('vite.config.mts'), 'utf8');
    expect(source).toContain('publicDir: false');
    expect(source).not.toContain("publicDir: '../../assets'");
  });

  it('does not copy local model sources or private models into the renderer build', async () => {
    const outputRoot = path.resolve('dist/renderer');
    const files = await listFiles(outputRoot);
    expect(files.some((file) => file.toLowerCase().endsWith('.cmo3'))).toBe(false);
    expect(files.some((file) => file.includes('heibaiMaoMao'))).toBe(false);
    expect(files.some((file) => file.includes('凯尔希live2d'))).toBe(false);
  });
});
