/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */

const path = require('node:path');
const { rm } = require('node:fs/promises');

const UNUSED_WEBGPU_DLLS = ['dxcompiler.dll', 'dxil.dll'];

const pruneElectronPackage = async (context) => {
  if (context.electronPlatformName !== 'win32') return;
  const outputRoot = path.resolve(context.appOutDir);
  for (const fileName of UNUSED_WEBGPU_DLLS) {
    const target = path.resolve(outputRoot, fileName);
    if (path.dirname(target) !== outputRoot) {
      throw new Error('Refusing to prune a file outside the Electron package root.');
    }
    await rm(target, { force: true });
  }
};

module.exports = pruneElectronPackage;
module.exports.pruneElectronPackage = pruneElectronPackage;
