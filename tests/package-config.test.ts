import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface PackageManifest {
  version?: unknown;
  productName?: unknown;
  dependencies?: Record<string, unknown>;
  scripts?: Record<string, unknown>;
  build?: {
    appId?: unknown;
    asar?: unknown;
    npmRebuild?: unknown;
    asarUnpack?: unknown;
    files?: unknown;
    extraResources?: unknown;
    electronLanguages?: unknown;
    afterPack?: unknown;
    win?: { target?: unknown; icon?: unknown; executableName?: unknown };
  };
}

describe('Windows portable package configuration', () => {
  it('keeps application dependencies inside ASAR and excludes development-only path trees', () => {
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as PackageManifest;

    expect(manifest.version).toBe('1.7.1');
    expect(manifest.productName).toBe('For People No Friend');
    expect(manifest.build?.appId).toBe('com.ph1gros.forpeoplenofriend');
    expect(manifest.build?.asar).toEqual({ smartUnpack: false });
    expect(manifest.build?.npmRebuild).toBe(false);
    expect(manifest.build?.asarUnpack).toEqual([
      'node_modules/uiohook-napi/prebuilds/win32-x64/**/*',
      'node_modules/sherpa-onnx-node/**/*',
      'node_modules/sherpa-onnx-win-x64/**/*',
    ]);
    expect(manifest.dependencies?.['uiohook-napi']).toBe('1.5.5');
    expect(manifest.dependencies?.['sherpa-onnx-node']).toBe('1.13.7');
    expect(manifest.scripts?.['smoke:sherpa-addon']).toBe(
      'electron scripts/verify-electron-sherpa-addon.cjs',
    );
    expect(manifest.scripts?.verify).toContain('pnpm smoke:sherpa-addon');
    expect(manifest.build?.win?.target).toBe('dir');
    expect(manifest.build?.win?.icon).toBe('build/icon.ico');
    expect(manifest.build?.win?.executableName).toBe('For People No Friend');
    expect(manifest.build?.files).toEqual(
      expect.arrayContaining(['build/icon.png', '!**/*.map', '!**/*.d.ts', '!**/*.ts']),
    );
    expect(manifest.build?.files).not.toContain('assets/**/*');
    expect(manifest.build?.files).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^!dist\/renderer\/models\//u)]),
    );
    expect(manifest.build?.electronLanguages).toEqual(['zh-CN', 'en-US']);
    expect(manifest.build?.afterPack).toBe('scripts/prune-electron-package.cjs');
    expect(manifest.build?.extraResources).toEqual(
      expect.arrayContaining([
        {
          from: 'resources/voice-runtime/ireina_tts_service.py',
          to: 'voice-runtime/ireina_tts_service.py',
        },
      ]),
    );
    expect(manifest.build?.extraResources).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: expect.stringContaining('sensevoice_asr_service.py') }),
      ]),
    );
    expect(manifest.build?.extraResources).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ from: 'resources/character-suite' })]),
    );
    expect(manifest.build?.extraResources).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: expect.stringContaining('PRIVATE_ASSET_NOTICE') }),
      ]),
    );
  });

  it('removes only the two unused WebGPU compiler DLLs after a Windows package build', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-package-prune-'));
    for (const name of ['dxcompiler.dll', 'dxil.dll', 'd3dcompiler_47.dll', 'libGLESv2.dll']) {
      await writeFile(path.join(directory, name), name);
    }
    await mkdir(path.join(directory, 'resources'));

    const { pruneElectronPackage } = (await import('../scripts/prune-electron-package.cjs')) as {
      pruneElectronPackage: (context: {
        appOutDir: string;
        electronPlatformName: string;
      }) => Promise<void>;
    };
    await pruneElectronPackage({ appOutDir: directory, electronPlatformName: 'win32' });

    await expect(readFile(path.join(directory, 'dxcompiler.dll'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(path.join(directory, 'dxil.dll'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(path.join(directory, 'd3dcompiler_47.dll'), 'utf8')).resolves.toBe(
      'd3dcompiler_47.dll',
    );
    await expect(readFile(path.join(directory, 'libGLESv2.dll'), 'utf8')).resolves.toBe(
      'libGLESv2.dll',
    );
  });
});
