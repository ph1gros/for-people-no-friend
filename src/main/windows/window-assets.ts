import path from 'node:path';

export interface WindowAssetPaths {
  preload: string;
  renderer: string;
}

export const resolveWindowAssetPaths = (compiledWindowDirectory: string): WindowAssetPaths => ({
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
