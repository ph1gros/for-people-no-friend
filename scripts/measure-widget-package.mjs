import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import process from 'node:process';
import console from 'node:console';
import { zipSync } from 'fflate';

const require = createRequire(import.meta.url);
const { inspectWidgetPackage } = require('../dist-electron/main/widgets/widget-package-loader.js');
const root = path.resolve(import.meta.dirname, '..');
const [id = 'clock', archiveArgument] = process.argv.slice(2);
if (!/^[A-Za-z0-9_-]{1,32}$/u.test(id)) throw new Error('Invalid widget ID');
let archive;
if (archiveArgument) {
  archive = await readFile(path.resolve(archiveArgument));
} else {
  const manifest = await readFile(path.join(root, 'docs/examples/widget-clock/manifest.json'));
  archive = zipSync({ 'manifest.json': manifest }, { level: 9, mtime: new Date(2020, 0, 1) });
}
const inspected = inspectWidgetPackage(archive, `${id}.zip`, ['input', 'media']);
if (inspected.manifest.capability.id !== id) throw new Error('Widget manifest ID mismatch');
const output = path.join(root, '.release/v1.9-widgets');
await mkdir(output, { recursive: true });
const measurement = {
  id,
  version: '1.0.0',
  target: id,
  sha256: createHash('sha256').update(archive).digest('hex'),
  compressedBytes: archive.length,
  extractedBytes: [...inspected.files.values()].reduce((sum, bytes) => sum + bytes.length, 0),
  maxEntries: inspected.files.size,
};
await writeFile(path.join(output, `${id}.zip`), archive);
await writeFile(path.join(output, `${id}-measurement.json`), JSON.stringify(measurement, null, 2));
console.log(JSON.stringify(measurement, null, 2));
// Deliberately never updates the production trust table or publishes a package.
