import { readFile } from 'node:fs/promises';
import { stdout } from 'node:process';
import { URL } from 'node:url';

for (const filename of ['index.cjs', 'resource-center.cjs']) {
  const preloadPath = new URL(`../dist-electron/preload/${filename}`, import.meta.url);
  const source = await readFile(preloadPath, 'utf8');

  if (!source.includes('exposeInMainWorld')) {
    throw new Error('The bundled preload does not expose the expected context bridge.');
  }
  if (/require\(["']\.\.?\//.test(source)) {
    throw new Error('The sandboxed preload still contains a relative module require.');
  }
}

stdout.write('Sandboxed preload bundle is self-contained.\n');
