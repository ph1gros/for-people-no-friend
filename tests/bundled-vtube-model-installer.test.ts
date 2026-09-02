import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BundledVTubeModelInstaller } from '../src/main/vtube-studio/bundled-vtube-model-installer';

describe('bundled VTube Studio model installer', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('copies only bounded model data into the fixed Steam VTube Studio directory', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-vtube-installer-'));
    const source = path.join(directory, 'source');
    const steam = path.join(directory, 'Steam');
    const destination = path.join(
      steam,
      'steamapps',
      'common',
      'VTube Studio',
      'VTube Studio_Data',
      'StreamingAssets',
      'Live2DModels',
    );
    await mkdir(path.join(source, 'model'), { recursive: true });
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(source, 'model', 'kitten.model3.json'), '{}');
    await writeFile(path.join(source, 'model', 'kitten.moc3'), 'model');
    await writeFile(path.join(source, 'model', 'source.psd'), 'excluded');
    const installer = new BundledVTubeModelInstaller(source, [steam]);

    await expect(installer.isAvailable()).resolves.toBe(true);
    await expect(installer.install()).resolves.toMatchObject({ ok: true });
    await expect(
      readFile(path.join(destination, 'FPNF-Kitten', 'model', 'kitten.moc3'), 'utf8'),
    ).resolves.toBe('model');
    await expect(
      readFile(path.join(destination, 'FPNF-Kitten', 'model', 'source.psd'), 'utf8'),
    ).rejects.toThrow();
  });

  it('fails closed when the release contains no model manifest', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-vtube-installer-'));
    const installer = new BundledVTubeModelInstaller(directory, [path.join(directory, 'Steam')]);
    await expect(installer.isAvailable()).resolves.toBe(false);
    await expect(installer.install()).resolves.toEqual({
      ok: false,
      message: '安装包中没有可再分发的 VTube Studio 模型。',
    });
  });
});
