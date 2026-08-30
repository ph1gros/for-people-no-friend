import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BundledSpeechRuntime } from '../src/main/speech/bundled-speech-runtime';

const requiredFiles = [
  'python/python.exe',
  'ireina_tts_service.py',
  'voice/ireina/ireina_e100_s16040.onnx',
  'voice/ireina/config.json',
  'voice/ireina/style_vectors.npy',
];

describe('bundled speech runtime', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('starts only the fixed bundled executable and local-only arguments', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-voice-runtime-'));
    for (const relativePath of requiredFiles) {
      const destination = path.join(directory, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, 'fake');
    }
    const canonicalDirectory = await realpath(directory);
    let checks = 0;
    const fetchHealth = vi.fn(async () => {
      checks += 1;
      return new Response(JSON.stringify({ status: 'ok', voice: 'ireina' }), {
        status: checks > 1 ? 200 : 503,
        headers: { 'content-type': 'application/json' },
      });
    });
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      killed: false,
      kill: vi.fn(() => true),
    });
    const spawnRuntime = vi.fn(() => child as never);
    const runtime = new BundledSpeechRuntime(directory, fetchHealth, spawnRuntime);

    await expect(runtime.ensureRunning()).resolves.toBe(true);
    expect(spawnRuntime).toHaveBeenCalledWith(
      path.join(canonicalDirectory, 'python', 'python.exe'),
      [
        '-m',
        'uvicorn',
        'ireina_tts_service:app',
        '--host',
        '127.0.0.1',
        '--port',
        '9881',
        '--log-level',
        'warning',
      ],
      {
        cwd: canonicalDirectory,
        windowsHide: true,
        stdio: 'ignore',
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', NO_PROXY: '127.0.0.1,localhost' },
      },
    );
    runtime.dispose();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('does not spawn when required assets are absent', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-voice-runtime-'));
    const spawnRuntime = vi.fn();
    const runtime = new BundledSpeechRuntime(
      directory,
      async () => new Response(null, { status: 503 }),
      spawnRuntime,
    );
    await expect(runtime.ensureRunning()).resolves.toBe(false);
    expect(spawnRuntime).not.toHaveBeenCalled();
  });
});
