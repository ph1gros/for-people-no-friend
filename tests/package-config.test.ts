import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface PackageManifest {
  version?: unknown;
  productName?: unknown;
  dependencies?: Record<string, unknown>;
  build?: {
    appId?: unknown;
    asar?: unknown;
    npmRebuild?: unknown;
    asarUnpack?: unknown;
    files?: unknown;
    win?: { target?: unknown; icon?: unknown; executableName?: unknown };
  };
}

describe('Windows portable package configuration', () => {
  it('keeps application dependencies inside ASAR and excludes development-only path trees', () => {
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as PackageManifest;

    expect(manifest.version).toBe('1.5.1');
    expect(manifest.productName).toBe('For People No Friend');
    expect(manifest.build?.appId).toBe('com.ph1gros.forpeoplenofriend');
    expect(manifest.build?.asar).toEqual({ smartUnpack: false });
    expect(manifest.build?.npmRebuild).toBe(false);
    expect(manifest.build?.asarUnpack).toEqual([
      'node_modules/uiohook-napi/prebuilds/win32-x64/**/*',
    ]);
    expect(manifest.dependencies?.['uiohook-napi']).toBe('1.5.5');
    expect(manifest.build?.win?.target).toBe('dir');
    expect(manifest.build?.win?.icon).toBe('build/icon.ico');
    expect(manifest.build?.win?.executableName).toBe('For People No Friend');
    expect(manifest.build?.files).toEqual(
      expect.arrayContaining(['build/icon.png', '!**/*.map', '!**/*.d.ts', '!**/*.ts']),
    );
  });
});
