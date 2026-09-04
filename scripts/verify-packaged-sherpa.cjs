/* eslint-disable @typescript-eslint/no-require-imports */
/* global AbortController, __filename, process, require */

// Local acceptance harness, excluded from application packaging. This runs the
// packaged executable's Node runtime; it does not start the user's desktop UI.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const worker = process.argv[2] === '--worker';
const args = process.argv.slice(worker ? 3 : 2);
if (args.length !== 3) {
  process.stderr.write(
    'Usage: node scripts/verify-packaged-sherpa.cjs <package-root> <model-root> <test-wav>\n',
  );
  process.exit(1);
}
const [packageRoot, modelRoot, wavPath] = args.map((value) => path.resolve(value));

if (!worker) {
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  env.ELECTRON_RUN_AS_NODE = '1';
  try {
    const output = execFileSync(
      path.join(packageRoot, 'For People No Friend.exe'),
      [__filename, '--worker', packageRoot, modelRoot, wavPath],
      { env, windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024, encoding: 'utf8' },
    );
    process.stdout.write(output);
  } catch (error) {
    process.stderr.write(error.stderr?.toString() || 'Packaged sherpa smoke failed.\n');
    process.exitCode = 1;
  }
} else {
  void (async () => {
    assert.ok(process.versions.electron, 'Must use the packaged Electron runtime.');
    const { LocalSherpaAsrAdapter } = require(
      path.join(
        packageRoot,
        'resources/app.asar/dist-electron/adapters/speech/local-sherpa-asr.js',
      ),
    );
    const missing = new LocalSherpaAsrAdapter([]);
    assert.equal(await missing.isAvailable(), false);
    missing.dispose();
    const adapter = new LocalSherpaAsrAdapter([modelRoot]);
    try {
      assert.equal(await adapter.isAvailable(), true);
      const result = await adapter.transcribe(
        {
          requestId: 'packaged-asr-smoke',
          audio: new Uint8Array(await readFile(wavPath)),
          mimeType: 'audio/wav',
          modelId: 'SenseVoiceSmall',
          language: 'zh-CN',
        },
        new AbortController().signal,
      );
      assert.equal(result.text, '你好，欢迎使用本地语音识别。今天天气很好。');
      process.stdout.write(
        `${JSON.stringify({
          electron: process.versions.electron,
          node: process.versions.node,
          mode: 'packaged-executable-node-smoke',
          missingModelUnavailable: true,
          text: result.text,
        })}\n`,
      );
    } finally {
      adapter.dispose();
    }
  })().catch((error) => {
    process.stderr.write(`Packaged sherpa smoke failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
