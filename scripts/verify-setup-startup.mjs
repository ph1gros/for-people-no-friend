import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { stdout } from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const electron = createRequire(import.meta.url)('electron');
const probe = fileURLToPath(new URL('./verify-setup-startup.cjs', import.meta.url));
for (const scenario of ['fresh', 'existing']) {
  const result = spawnSync(electron, [probe, scenario], { encoding: 'utf8', timeout: 40000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `Electron ${scenario} startup failed: ${result.stderr}`);
  // Electron may exit with code 0 when its last window disappears before startup finishes.
  // Require the explicit success record as well as the process exit code.
  const record = result.stdout.split(/\r?\n/u).find((line) => line.includes('"passed":true'));
  assert.ok(record, `Electron ${scenario} exited before completing its startup assertions.`);
  stdout.write(`${record}\n`);
}
