/* eslint-disable @typescript-eslint/no-require-imports */
/* global process, require */

const { app } = require('electron');

void app.whenReady().then(async () => {
  try {
    const sherpa = await import('sherpa-onnx-node');
    const addon = sherpa.OfflineRecognizer ? sherpa : sherpa.default;
    const createRecognizer = addon?.OfflineRecognizer?.createAsync;
    const result = {
      electron: process.versions.electron,
      node: process.versions.node,
      offlineRecognizer: typeof createRecognizer,
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    app.exit(result.offlineRecognizer === 'function' ? 0 : 1);
  } catch (error) {
    process.stderr.write(`sherpa-onnx-node failed to load: ${String(error)}\n`);
    app.exit(1);
  }
});
