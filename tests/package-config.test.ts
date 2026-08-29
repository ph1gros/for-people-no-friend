import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface PackageManifest {
  version?: unknown;
  build?: {
    asar?: unknown;
    files?: unknown;
    win?: { target?: unknown };
  };
}

describe('Windows portable package configuration', () => {
  it('keeps application dependencies inside ASAR and excludes development-only path trees', () => {
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as PackageManifest;

    expect(manifest.version).toBe('1.4.1');
    expect(manifest.build?.asar).toBe(true);
    expect(manifest.build?.win?.target).toBe('dir');
    expect(manifest.build?.files).toEqual(
      expect.arrayContaining(['!**/*.map', '!**/*.d.ts', '!**/*.ts']),
    );
  });
});
