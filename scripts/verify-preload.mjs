import { readFile } from 'node:fs/promises';
import { stdout } from 'node:process';
import { URL } from 'node:url';

const BUNDLES = [
  { file: 'index.cjs', bridge: 'deskpet' },
  { file: 'resource-center.cjs', bridge: 'resourceCenterApi' },
  { file: 'setup.cjs', bridge: 'deskpetSetup' },
];

for (const bundle of BUNDLES) {
  const preloadPath = new URL(`../dist-electron/preload/${bundle.file}`, import.meta.url);
  const source = await readFile(preloadPath, 'utf8');

  if (!source.includes('exposeInMainWorld')) {
    throw new Error(
      `The bundled preload ${bundle.file} does not expose the expected context bridge.`,
    );
  }
  if (!source.includes(bundle.bridge)) {
    throw new Error(`The bundled preload ${bundle.file} does not expose ${bundle.bridge}.`);
  }
  if (/require\(["']\.\.?\//.test(source)) {
    throw new Error(
      `The sandboxed preload ${bundle.file} still contains a relative module require.`,
    );
  }
}

stdout.write('Sandboxed preload bundles are self-contained.\n');
