import { createHash } from 'node:crypto';

import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { CharacterPackageManifest } from '../src/core/character/character-package';
import { DEFAULT_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';
import {
  createCharacterPackageArchive,
  inspectCharacterPackageArchive,
} from '../src/main/character/character-package-archive';

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('character package ZIP boundary', () => {
  const asset = strToU8('{"version":1}');
  const manifest: CharacterPackageManifest = {
    version: 1,
    packageId: 'safe-package',
    character: DEFAULT_CHARACTER_PROFILE,
    modelManifest: 'live2d/model.json',
    assets: [{ path: 'live2d/model.json', sha256: digest(asset) }],
    attribution: [
      { title: 'Fake source', url: 'https://example.com/source', licenseNote: 'Test only.' },
    ],
    minimumAppVersion: '1.4.0',
  };

  it('round-trips a bounded package and verifies every asset digest', () => {
    const archive = createCharacterPackageArchive(
      manifest,
      new Map([['live2d/model.json', asset]]),
    );
    const inspected = inspectCharacterPackageArchive(archive);
    expect(inspected.manifest.packageId).toBe('safe-package');
    expect(inspected.files.get('live2d/model.json')).toEqual(asset);
  });

  it('rejects traversal, executable entries, undeclared files and bad hashes', () => {
    const manifestBytes = strToU8(`${JSON.stringify(manifest)}\n`);
    expect(() =>
      inspectCharacterPackageArchive(
        zipSync({ 'manifest.json': manifestBytes, '../escape.txt': strToU8('bad') }),
      ),
    ).toThrow();
    expect(() =>
      inspectCharacterPackageArchive(
        zipSync({ 'manifest.json': manifestBytes, 'live2d/run.ps1': strToU8('bad') }),
      ),
    ).toThrow();
    expect(() =>
      inspectCharacterPackageArchive(
        zipSync({ 'manifest.json': manifestBytes, 'live2d/model.json': strToU8('tampered') }),
      ),
    ).toThrow();
  });
});
