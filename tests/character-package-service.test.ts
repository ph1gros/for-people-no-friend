import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CharacterPackageManifest } from '../src/core/character/character-package';
import {
  DEFAULT_CHARACTER_PROFILE,
  KALTSIT_CHARACTER_PROFILE,
} from '../src/core/conversation/character-profile';
import { createCharacterPackageArchive } from '../src/main/character/character-package-archive';
import { inspectCharacterPackageArchive } from '../src/main/character/character-package-archive';
import { CharacterPackageService } from '../src/main/character/character-package-service';
import { CharacterProfileStore } from '../src/main/storage/character-profile-store';

const temporaryDirectories: string[] = [];

const createService = async (): Promise<{
  service: CharacterPackageService;
  profiles: CharacterProfileStore;
}> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fpnf-character-package-'));
  temporaryDirectories.push(directory);
  const profiles = new CharacterProfileStore(directory);
  return { service: new CharacterPackageService(directory, profiles, '1.4.0'), profiles };
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('character package service', () => {
  const manifest: CharacterPackageManifest = {
    version: 1,
    packageId: 'test-role',
    character: {
      ...DEFAULT_CHARACTER_PROFILE,
      id: 'test-role',
      name: '测试角色',
      userDisplayName: '私人称呼',
      memoryNamespace: 'character-test-role',
    },
    assets: [],
    attribution: [],
    minimumAppVersion: '1.4.0',
  };

  it('previews, confirms, activates and round-trips public character data', async () => {
    const { service, profiles } = await createService();
    const preview = await service.preview(createCharacterPackageArchive(manifest, new Map()));
    expect(preview.conflict).toBe('none');
    await service.confirmImport(preview.previewId, false);
    expect((await profiles.get()).id).toBe('test-role');
    expect((await service.list()).find(({ profile }) => profile.id === 'test-role')?.imported).toBe(
      true,
    );

    const exported = await service.exportActive();
    expect(exported.fileName).toBe('测试角色.fpnf-character.zip');
    const second = await createService();
    const secondPreview = await second.service.preview(exported.bytes);
    await second.service.confirmImport(secondPreview.previewId, false);
    expect((await second.profiles.get()).name).toBe('测试角色');
    expect((await second.profiles.get()).userDisplayName).toBe('你');
  });

  it('requires explicit replacement and blocks duplicate namespaces owned by another role', async () => {
    const { service } = await createService();
    const archive = createCharacterPackageArchive(manifest, new Map());
    const first = await service.preview(archive);
    await service.confirmImport(first.previewId, false);
    const replacement = await service.preview(archive);
    expect(replacement.conflict).toBe('replace');
    await expect(service.confirmImport(replacement.previewId, false)).rejects.toThrow();

    const conflicting = {
      ...manifest,
      packageId: 'other-package',
      character: { ...manifest.character, id: 'other-role' },
    } satisfies CharacterPackageManifest;
    const blocked = await service.preview(createCharacterPackageArchive(conflicting, new Map()));
    expect(blocked.conflict).toBe('blocked');
  });

  it('clears every inactive local role and package while preserving the active role', async () => {
    const { service, profiles } = await createService();
    const preview = await service.preview(createCharacterPackageArchive(manifest, new Map()));
    await service.confirmImport(preview.previewId, false);
    await profiles.add({
      ...DEFAULT_CHARACTER_PROFILE,
      id: 'local-extra',
      name: '额外角色',
      memoryNamespace: 'character-local-extra',
    });

    await expect(service.clearInactive()).resolves.toBe(2);
    expect((await profiles.get()).id).toBe('test-role');
    expect((await service.list()).map(({ profile }) => profile.id)).toEqual(['test-role']);
    expect((await service.list())[0]?.imported).toBe(true);
  });

  it('exports the bundled current Live2D runtime assets but not Cubism executable code', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'fpnf-character-package-'));
    temporaryDirectories.push(directory);
    const modelRoot = path.join(directory, 'models');
    await mkdir(path.join(modelRoot, 'role'), { recursive: true });
    await writeFile(
      path.join(modelRoot, 'model.json'),
      JSON.stringify({
        version: 1,
        name: '测试',
        core: 'live2dcubismcore.min.js',
        model: 'role/role.model3.json',
        controls: { states: {}, actions: {}, emotions: {} },
      }),
    );
    await writeFile(
      path.join(modelRoot, 'role', 'role.model3.json'),
      JSON.stringify({
        FileReferences: {
          Moc: 'role.moc3',
          Textures: ['texture.png'],
          Motions: { Idle: [{ File: 'idle.motion3.json' }] },
        },
      }),
    );
    await writeFile(path.join(modelRoot, 'role', 'role.moc3'), 'fake-moc');
    await writeFile(path.join(modelRoot, 'role', 'texture.png'), 'fake-texture');
    await writeFile(path.join(modelRoot, 'role', 'idle.motion3.json'), '{}');
    await writeFile(path.join(modelRoot, 'live2dcubismcore.min.js'), 'must-not-export');
    const profiles = new CharacterProfileStore(directory, KALTSIT_CHARACTER_PROFILE);
    const service = new CharacterPackageService(directory, profiles, '1.4.0', modelRoot);

    const inspected = inspectCharacterPackageArchive((await service.exportActive()).bytes);
    expect(inspected.manifest.modelManifest).toBe('live2d/model.json');
    expect([...inspected.files.keys()]).toEqual(
      expect.arrayContaining([
        'live2d/model.json',
        'live2d/role/role.model3.json',
        'live2d/role/role.moc3',
        'live2d/role/texture.png',
        'live2d/role/idle.motion3.json',
      ]),
    );
    expect([...inspected.files.keys()].some((item) => item.endsWith('.js'))).toBe(false);
  });
});
