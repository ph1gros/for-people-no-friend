import { describe, expect, it } from 'vitest';

import { validateCharacterPackageManifest } from '../src/core/character/character-package';
import { DEFAULT_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';

const valid = {
  version: 1,
  packageId: 'deskpet-example',
  character: DEFAULT_CHARACTER_PROFILE,
  modelManifest: 'live2d/model.json',
  assets: [{ path: 'live2d/model.json', sha256: 'a'.repeat(64) }],
  attribution: [{ title: 'Example', url: 'https://example.com/source', licenseNote: 'For tests.' }],
  minimumAppVersion: '1.4.0',
};

describe('character package manifest', () => {
  it('validates a versioned package without private conversation data', () => {
    expect(validateCharacterPackageManifest(valid)).toMatchObject({ packageId: 'deskpet-example' });
  });

  it('rejects traversal, duplicate assets and credentialed attribution URLs', () => {
    expect(() =>
      validateCharacterPackageManifest({ ...valid, modelManifest: '../secret' }),
    ).toThrow();
    expect(() =>
      validateCharacterPackageManifest({ ...valid, assets: [valid.assets[0], valid.assets[0]] }),
    ).toThrow();
    expect(() =>
      validateCharacterPackageManifest({
        ...valid,
        attribution: [{ ...valid.attribution[0], url: 'https://user:pass@example.com' }],
      }),
    ).toThrow();
  });
});
