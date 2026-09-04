import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BundledSpeechRuntime,
  resolveBundledSpeechRuntimeSources,
} from '../src/main/speech/bundled-speech-runtime';

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

  it('keeps the engine model id separate from the Ireina voice id', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'resources', 'voice-runtime', 'ireina_tts_service.py'),
      'utf8',
    );
    expect(source).toContain('request.model != "style-bert-vits2"');
    expect(source).toContain('request.voice != "ireina"');
    expect(source).not.toContain('request.model != "ireina" or request.voice != "ireina"');
    expect(source).toContain('def infer_with_runtime_fallback(');
    expect(source).toContain('reset_model(force_cpu=True)');
    expect(source).toContain('if providers[0] == "DmlExecutionProvider"');
    expect(source).toContain('@app.get("/ready")');
  });

  it('prefers downloaded user assets without removing packaged or development fallbacks', () => {
    expect(
      resolveBundledSpeechRuntimeSources({
        appPath: 'C:\\workspace',
        resourcesPath: 'C:\\electron-resources',
        userDataPath: 'C:\\user-data',
        packaged: true,
      }),
    ).toEqual([
      { runtimeRoot: 'C:\\user-data\\speech-assets\\voice-runtime', downloadedAsset: true },
      'C:\\electron-resources\\voice-runtime',
    ]);
    expect(
      resolveBundledSpeechRuntimeSources({
        appPath: 'C:\\workspace',
        resourcesPath: 'C:\\electron-resources',
        userDataPath: 'C:\\user-data',
        packaged: false,
      }),
    ).toEqual([
      { runtimeRoot: 'C:\\user-data\\speech-assets\\voice-runtime', downloadedAsset: true },
      'C:\\electron-resources\\voice-runtime',
      {
        runtimeRoot: 'C:\\workspace\\data\\v1.6-portable-voice-runtime',
        serviceRoot: 'C:\\workspace\\resources\\voice-runtime',
      },
    ]);
  });

  it('does not reuse unverified downloaded executables left by an older build', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-legacy-speech-'));
    const downloaded = path.join(directory, 'speech-assets', 'voice-runtime');
    for (const relativePath of requiredFiles) {
      const destination = path.join(downloaded, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, 'fake');
    }
    const runtime = new BundledSpeechRuntime(
      resolveBundledSpeechRuntimeSources({
        appPath: directory,
        resourcesPath: path.join(directory, 'resources'),
        userDataPath: directory,
        packaged: true,
      }),
    );
    await expect(runtime.resolveAvailableRoot()).resolves.toBeUndefined();
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
      return new Response(
        JSON.stringify({ status: 'ready', voice: 'ireina', provider: 'CPUExecutionProvider' }),
        {
          status: checks > 1 ? 200 : 503,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    const stderr = new PassThrough();
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      killed: false,
      kill: vi.fn(() => true),
      stderr,
    });
    const spawnRuntime = vi.fn(() => child as never);
    const diagnostics: string[] = [];
    const runtime = new BundledSpeechRuntime(directory, fetchHealth, spawnRuntime, (event) => {
      diagnostics.push(event);
    });

    await expect(runtime.ensureRunning()).resolves.toBe(true);
    expect(spawnRuntime).toHaveBeenCalledWith(
      path.join(canonicalDirectory, 'python', 'python.exe'),
      [
        '-m',
        'uvicorn',
        '--app-dir',
        canonicalDirectory,
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
        stdio: ['ignore', 'ignore', 'pipe'],
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '1',
          NO_PROXY: '127.0.0.1,localhost',
        },
      },
    );
    expect(fetchHealth).toHaveBeenCalledWith(
      'http://127.0.0.1:9881/ready',
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
    stderr.write('FPNF_TTS_PROVIDER_FALLBACK CPUExecutionProvider\n');
    await new Promise((resolve) => setImmediate(resolve));
    expect(diagnostics).toContain('FPNF_TTS_PROVIDER_FALLBACK CPUExecutionProvider');
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

  it('uses the first complete runtime when an earlier development candidate is incomplete', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-voice-runtime-candidates-'));
    const incompleteRoot = path.join(directory, 'incomplete');
    const completeRoot = path.join(directory, 'complete');
    await mkdir(incompleteRoot, { recursive: true });
    for (const relativePath of requiredFiles) {
      const destination = path.join(completeRoot, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, 'fake');
    }
    const canonicalCompleteRoot = await realpath(completeRoot);
    let checks = 0;
    const fetchHealth = vi.fn(async () => {
      checks += 1;
      return new Response(
        JSON.stringify({ status: 'ready', voice: 'ireina', provider: 'CPUExecutionProvider' }),
        {
          status: checks > 1 ? 200 : 503,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      killed: false,
      kill: vi.fn(() => true),
      stderr: new PassThrough(),
    });
    const spawnRuntime = vi.fn(() => child as never);
    const runtime = new BundledSpeechRuntime(
      [incompleteRoot, completeRoot],
      fetchHealth,
      spawnRuntime,
    );

    await expect(runtime.ensureRunning()).resolves.toBe(true);
    expect(spawnRuntime).toHaveBeenCalledWith(
      path.join(canonicalCompleteRoot, 'python', 'python.exe'),
      expect.any(Array),
      expect.objectContaining({ cwd: canonicalCompleteRoot }),
    );
    runtime.dispose();
  });

  it('reports the complete runtime root without starting a process', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-voice-runtime-status-'));
    const incompleteRoot = path.join(directory, 'incomplete');
    const completeRoot = path.join(directory, 'complete');
    await mkdir(incompleteRoot, { recursive: true });
    for (const relativePath of requiredFiles) {
      const destination = path.join(completeRoot, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, 'fake');
    }
    const canonicalCompleteRoot = await realpath(completeRoot);
    const spawnRuntime = vi.fn();
    const runtime = new BundledSpeechRuntime(
      [incompleteRoot, completeRoot],
      async () => new Response(null, { status: 503 }),
      spawnRuntime,
    );

    await expect(runtime.resolveAvailableRoot()).resolves.toBe(canonicalCompleteRoot);
    expect(spawnRuntime).not.toHaveBeenCalled();
  });

  it('starts a development runtime with the maintained service module and private local assets', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-split-voice-runtime-'));
    const runtimeRoot = path.join(directory, 'private-runtime');
    const serviceRoot = path.join(directory, 'maintained-service');
    for (const relativePath of requiredFiles.filter((file) => file !== 'ireina_tts_service.py')) {
      const destination = path.join(runtimeRoot, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, 'fake');
    }
    await mkdir(serviceRoot, { recursive: true });
    await writeFile(path.join(serviceRoot, 'ireina_tts_service.py'), 'fake');
    const canonicalRuntimeRoot = await realpath(runtimeRoot);
    const canonicalServiceRoot = await realpath(serviceRoot);
    let checks = 0;
    const fetchHealth = vi.fn(async () => {
      checks += 1;
      return new Response(
        JSON.stringify({ status: 'ready', voice: 'ireina', provider: 'CPUExecutionProvider' }),
        {
          status: checks > 1 ? 200 : 503,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      killed: false,
      kill: vi.fn(() => true),
      stderr: new PassThrough(),
    });
    const spawnRuntime = vi.fn(() => child as never);
    const runtime = new BundledSpeechRuntime(
      { runtimeRoot, serviceRoot },
      fetchHealth,
      spawnRuntime,
    );

    await expect(runtime.ensureRunning()).resolves.toBe(true);
    expect(spawnRuntime).toHaveBeenCalledWith(
      path.join(canonicalRuntimeRoot, 'python', 'python.exe'),
      expect.any(Array),
      expect.objectContaining({
        cwd: canonicalServiceRoot,
        env: expect.objectContaining({
          FPNF_BUNDLED_VOICE_ROOT: path.join(canonicalRuntimeRoot, 'voice', 'ireina'),
        }),
      }),
    );
    runtime.dispose();
  });
});
