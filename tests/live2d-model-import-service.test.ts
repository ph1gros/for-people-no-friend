import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';
import { Live2DModelImportService } from '../src/main/live2d/live2d-model-import-service';
import type { CharacterProfileStore } from '../src/main/storage/character-profile-store';

const temporaryDirectories: string[] = [];

const createService = async (): Promise<{
  service: Live2DModelImportService;
  source: string;
}> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fpnf-live2d-import-'));
  temporaryDirectories.push(directory);
  const source = path.join(directory, 'source');
  await mkdir(source, { recursive: true });
  const profiles = {
    get: async () => DEFAULT_CHARACTER_PROFILE,
  } as CharacterProfileStore;
  return {
    service: new Live2DModelImportService(path.join(directory, 'user-data'), profiles),
    source,
  };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Live2DModelImportService', () => {
  it('imports only the files referenced by a selected model and exposes a generated manifest', async () => {
    const { service, source } = await createService();
    await mkdir(path.join(source, 'textures'), { recursive: true });
    await mkdir(path.join(source, 'motions'), { recursive: true });
    await writeFile(
      path.join(source, 'sample.model3.json'),
      JSON.stringify({
        Version: 3,
        FileReferences: {
          Moc: 'sample.moc3',
          Textures: ['textures/body.png'],
          Physics: 'physics.json',
          Motions: { Idle: [{ File: 'motions/idle.motion3.json' }] },
        },
      }),
    );
    await writeFile(path.join(source, 'sample.moc3'), 'fake-moc');
    await writeFile(path.join(source, 'textures', 'body.png'), 'fake-png');
    await writeFile(path.join(source, 'physics.json'), '{}');
    await writeFile(path.join(source, 'motions', 'idle.motion3.json'), '{}');
    await writeFile(path.join(source, 'unused.png'), 'must-not-import');

    const result = await service.importModel(path.join(source, 'sample.model3.json'));

    expect(result).toMatchObject({ modelName: 'sample', assetCount: 5 });
    expect(await service.getActiveModelManifest()).toBe('live2d/model.json');
    const manifestPath = await service.resolveActiveAsset('live2d/model.json');
    expect(manifestPath).toBeTruthy();
    expect(JSON.parse(await readFile(manifestPath!, 'utf8'))).toMatchObject({
      version: 1,
      name: 'sample',
      core: 'live2dcubismcore.min.js',
      model: 'model/sample.model3.json',
      controls: { states: {}, actions: {}, emotions: {} },
    });
    expect(await service.resolveActiveAsset('live2d/model/textures/body.png')).toBeTruthy();
    expect(await service.resolveActiveAsset('live2d/model/unused.png')).toBeUndefined();

    const exportRoot = path.join(path.dirname(source), 'exports');
    await mkdir(exportRoot);
    const exported = await service.exportActiveModel(exportRoot);
    const exportedRoot = path.join(exportRoot, exported.directoryName);
    expect(exported).toMatchObject({ modelName: 'sample', assetCount: 5 });
    expect(await readFile(path.join(exportedRoot, 'sample.model3.json'), 'utf8')).toContain(
      'sample.moc3',
    );
    expect(await readFile(path.join(exportedRoot, 'textures', 'body.png'), 'utf8')).toBe(
      'fake-png',
    );
    await expect(readFile(path.join(exportedRoot, 'unused.png'))).rejects.toThrow();
  });

  it('rejects traversal, remote resources, legacy models, and missing referenced files', async () => {
    const { service, source } = await createService();
    await writeFile(
      path.join(source, 'escape.model3.json'),
      JSON.stringify({
        FileReferences: { Moc: '../escape.moc3', Textures: ['texture.png'] },
      }),
    );
    await writeFile(
      path.join(source, 'remote.model3.json'),
      JSON.stringify({
        FileReferences: {
          Moc: 'https://example.com/model.moc3',
          Textures: ['texture.png'],
        },
      }),
    );
    await writeFile(
      path.join(source, 'missing.model3.json'),
      JSON.stringify({ FileReferences: { Moc: 'missing.moc3', Textures: ['texture.png'] } }),
    );
    await writeFile(path.join(source, 'texture.png'), 'fake-texture');
    await writeFile(path.join(source, 'legacy.model.json'), '{}');

    await expect(service.importModel(path.join(source, 'escape.model3.json'))).rejects.toThrow(
      '越过',
    );
    await expect(service.importModel(path.join(source, 'remote.model3.json'))).rejects.toThrow(
      '远程或不安全',
    );
    await expect(service.importModel(path.join(source, 'missing.model3.json'))).rejects.toThrow();
    await expect(service.importModel(path.join(source, 'legacy.model.json'))).rejects.toThrow(
      '.model3.json',
    );
  });

  it('refuses to export when the active character has no user-imported model', async () => {
    const { service, source } = await createService();
    const exportRoot = path.join(path.dirname(source), 'exports');
    await mkdir(exportRoot);

    await expect(service.exportActiveModel(exportRoot)).rejects.toThrow('没有通过 FPNF 导入');
  });
});
