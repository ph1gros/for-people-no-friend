/* eslint-disable @typescript-eslint/no-require-imports */
/* global AbortController, process, require */

const { readFile } = require('node:fs/promises');
const { app } = require('electron');

void app.whenReady().then(async () => {
  let adapter;
  try {
    const modelRoot = process.env.FPNF_SENSEVOICE_MODEL_ROOT;
    const wavPath = process.env.FPNF_SENSEVOICE_TEST_WAV;
    if (!modelRoot || !wavPath) {
      throw new Error(
        'Set FPNF_SENSEVOICE_MODEL_ROOT and FPNF_SENSEVOICE_TEST_WAV to run this optional smoke.',
      );
    }
    const {
      LocalSherpaAsrAdapter,
    } = require('../dist-electron/adapters/speech/local-sherpa-asr.js');
    adapter = new LocalSherpaAsrAdapter([modelRoot]);
    const result = await adapter.transcribe(
      {
        requestId: 'electron-sherpa-smoke',
        audio: new Uint8Array(await readFile(wavPath)),
        mimeType: 'audio/wav',
        modelId: 'SenseVoiceSmall',
        language: 'zh-CN',
      },
      new AbortController().signal,
    );
    process.stdout.write(`${JSON.stringify({ text: result.text })}\n`);
    adapter.dispose();
    app.exit(result.text.trim() ? 0 : 1);
  } catch (error) {
    adapter?.dispose();
    process.stderr.write(`Local sherpa transcription failed: ${String(error)}\n`);
    app.exit(1);
  }
});
