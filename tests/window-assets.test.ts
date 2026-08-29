import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  resolveBundledModelRoot,
  resolveWindowAssetPaths,
} from '../src/main/windows/window-assets';

describe('compiled window asset paths', () => {
  it('resolves preload and renderer output from the compiled window directory', () => {
    const repository = path.resolve('C:/example/for-people-no-friend');
    const compiledWindowDirectory = path.join(repository, 'dist-electron', 'main', 'windows');

    expect(resolveWindowAssetPaths(compiledWindowDirectory)).toEqual({
      icon: path.join(repository, 'build', 'icon.png'),
      preload: path.join(repository, 'dist-electron', 'preload', 'index.cjs'),
      renderer: path.join(repository, 'dist', 'renderer', 'index.html'),
    });
  });

  it('resolves the bundled model from the compiled main directory', () => {
    const repository = path.resolve('C:/example/for-people-no-friend');
    const compiledMainDirectory = path.join(repository, 'dist-electron', 'main');

    expect(resolveBundledModelRoot(compiledMainDirectory)).toBe(
      path.join(repository, 'dist', 'renderer', 'models', 'local'),
    );
  });
});
