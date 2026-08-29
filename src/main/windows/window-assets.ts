import path from 'node:path';

export interface WindowAssetPaths {
  icon: string;
  preload: string;
  renderer: string;
}

export const resolveWindowAssetPaths = (compiledWindowDirectory: string): WindowAssetPaths => ({
  icon: path.resolve(compiledWindowDirectory, '..', '..', '..', 'build', 'icon.png'),
  preload: path.resolve(compiledWindowDirectory, '..', '..', 'preload', 'index.cjs'),
  renderer: path.resolve(
    compiledWindowDirectory,
    '..',
    '..',
    '..',
    'dist',
    'renderer',
    'index.html',
  ),
});

export const resolveBundledModelRoot = (compiledMainDirectory: string): string =>
  path.join(
    path.dirname(resolveWindowAssetPaths(path.join(compiledMainDirectory, 'windows')).renderer),
    'models',
    'local',
  );
