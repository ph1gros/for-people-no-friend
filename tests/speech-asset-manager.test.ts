import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SpeechAssetManager,
  detectWindowsMeteredConnection,
  type SpeechAssetInstaller,
} from '../src/main/speech/speech-asset-manager';
import { parseSpeechAssetControlInput } from '../src/shared/speech-asset-ipc';
import type { SpeechAssetManifest } from '../src/main/speech/speech-asset-downloader';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: execFileMock }));

vi.mock('../src/main/speech/speech-asset-integrity', () => ({
  SPEECH_ASSET_INTEGRITY: {
    'voice-runtime': {
      version: '1.0.0',
      target: 'voice-runtime',
      sha256: 'a'.repeat(64),
      compressedBytes: 240,
      extractedBytes: 1000,
      maxEntries: 20,
    },
    'speech-input': {
      version: '1.0.0',
      target: 'speech-input-runtime',
      sha256: 'b'.repeat(64),
      compressedBytes: 225,
      extractedBytes: 1000,
      maxEntries: 20,
    },
  },
}));

const roots: string[] = [];
const manifest: SpeechAssetManifest = {
  schemaVersion: 2,
  tiers: [
    {
      id: 'voice-runtime',
      version: '1.0.0',
      target: 'voice-runtime',
      bytes: 240,
      sha256: 'a'.repeat(64),
      extractedBytes: 1000,
      maxEntries: 20,
      urls: ['https://downloads.example.com/voice.zip'],
    },
    {
      id: 'speech-input',
      version: '1.0.0',
      target: 'speech-input-runtime',
      bytes: 225,
      sha256: 'b'.repeat(64),
      extractedBytes: 1000,
      maxEntries: 20,
      urls: ['https://downloads.example.com/input.zip'],
    },
  ],
};

const makeRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'fpnf-speech-manager-'));
  roots.push(root);
  return root;
};

describe('speech asset manager', () => {
  beforeEach(() => {
    execFileMock
      .mockReset()
      .mockImplementation(
        (
          _file: string,
          _args: string[],
          _options: unknown,
          callback: (error: Error | null, stdout: string) => void,
        ) => callback(null, 'Unrestricted'),
      );
  });
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('rejects unknown renderer commands and extra fields', () => {
    expect(parseSpeechAssetControlInput({ tierId: 'speech-input', action: 'start' })).toEqual({
      tierId: 'speech-input',
      action: 'start',
    });
    expect(() =>
      parseSpeechAssetControlInput({ tierId: 'speech-input', action: 'delete' }),
    ).toThrow();
    expect(() =>
      parseSpeechAssetControlInput({
        tierId: 'speech-input',
        action: 'start',
        url: 'https://evil',
      }),
    ).toThrow();
  });

  it.runIf(process.platform === 'win32').each([
    ['Fixed', true],
    ['Variable', true],
    ['Unrestricted', false],
    ['Unknown', undefined],
    ['unexpected output', undefined],
  ])('reports network cost %s without treating unknown as unmetered', async (output, expected) => {
    execFileMock.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string) => void,
      ) => callback(null, String(output)),
    );
    expect(await detectWindowsMeteredConnection()).toBe(expected);
    expect(execFileMock).toHaveBeenCalledWith(
      'powershell.exe',
      expect.any(Array),
      { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 },
      expect.any(Function),
    );
  });

  it('keeps text chat usable when no production manifest source is configured', async () => {
    const manager = new SpeechAssetManager(await makeRoot(), undefined);
    await expect(manager.getStatus()).resolves.toMatchObject({
      sourceConfigured: false,
      busy: false,
      tiers: [],
    });
  });

  it('allows a localhost manifest only when explicitly enabled for private development tests', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 2,
            tiers: manifest.tiers.map(({ id, version, urls }) => ({ id, version, urls })),
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
    );
    const manager = new SpeechAssetManager(
      await makeRoot(),
      'http://127.0.0.1:8765/manifest.json',
      {
        fetch: fetcher,
        allowLocalhostHttp: true,
      },
    );

    await expect(manager.getStatus()).resolves.toMatchObject({
      sourceConfigured: true,
      tiers: expect.arrayContaining([expect.objectContaining({ id: 'voice-runtime' })]),
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('starts in the background, publishes progress, and becomes ready', async () => {
    const install = vi.fn(async (tier) => ({
      id: tier.id,
      state: 'ready' as const,
      downloadedBytes: tier.bytes,
      totalBytes: tier.bytes,
    }));
    const notify = vi.fn();
    const onTierReady = vi.fn();
    const installer: SpeechAssetInstaller = {
      install,
      pause: vi.fn(),
      cancel: vi.fn(),
    };
    const manager = new SpeechAssetManager(
      await makeRoot(),
      'https://manifest.example.com/v1.json',
      {
        loadManifest: vi.fn(async () => manifest),
        createInstaller: () => installer,
        notify,
        onTierReady,
      },
    );

    await expect(
      manager.control({ tierId: 'voice-runtime', action: 'start' }),
    ).resolves.toMatchObject({
      busy: true,
    });
    await vi.waitFor(async () => {
      expect(await manager.getStatus()).toMatchObject({
        busy: false,
        tiers: expect.arrayContaining([
          expect.objectContaining({ id: 'voice-runtime', state: 'ready' }),
        ]),
      });
    });
    expect(install).toHaveBeenCalledWith(manifest.tiers[0]);
    expect(notify).toHaveBeenCalled();
    expect(onTierReady).toHaveBeenCalledWith('voice-runtime');
  });

  it('does not auto-download on a metered connection', async () => {
    const install = vi.fn();
    const manager = new SpeechAssetManager(
      await makeRoot(),
      'https://manifest.example.com/v1.json',
      {
        loadManifest: vi.fn(async () => manifest),
        createInstaller: () => ({ install, pause: vi.fn(), cancel: vi.fn() }),
        detectMetered: vi.fn(async () => true),
        delay: vi.fn(async () => undefined),
      },
    );

    await manager.scheduleInitialDownload();

    expect(install).not.toHaveBeenCalled();
    await expect(manager.getStatus()).resolves.toMatchObject({ metered: true, busy: false });
  });

  it('refreshes network cost on manual start and resume without blocking metered downloads', async () => {
    const detectMetered = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const install = vi.fn(async () => ({
      id: 'voice-runtime' as const,
      state: 'paused' as const,
      downloadedBytes: 0,
      totalBytes: 240,
    }));
    const manager = new SpeechAssetManager(
      await makeRoot(),
      'https://manifest.example.com/v1.json',
      {
        loadManifest: async () => manifest,
        createInstaller: () => ({ install, pause: vi.fn(), cancel: vi.fn() }),
        detectMetered,
      },
    );
    await expect(
      manager.control({ tierId: 'voice-runtime', action: 'start' }),
    ).resolves.toMatchObject({ metered: true });
    await vi.waitFor(async () => expect((await manager.getStatus()).busy).toBe(false));
    expect(install).toHaveBeenCalledOnce();
    await expect(
      manager.control({ tierId: 'voice-runtime', action: 'resume' }),
    ).resolves.toMatchObject({ metered: false });
    await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(2));
    expect(detectMetered).toHaveBeenCalledTimes(2);
  });

  it('does not start automatically when network cost detection fails', async () => {
    const install = vi.fn();
    const manager = new SpeechAssetManager(
      await makeRoot(),
      'https://manifest.example.com/v1.json',
      {
        loadManifest: async () => manifest,
        createInstaller: () => ({ install, pause: vi.fn(), cancel: vi.fn() }),
        detectMetered: async () => {
          throw new Error('probe unavailable');
        },
        delay: async () => undefined,
      },
    );
    await expect(manager.scheduleInitialDownload()).resolves.toBeUndefined();
    expect(install).not.toHaveBeenCalled();
    expect((await manager.getStatus()).message).toContain('无法确认');
  });

  it('does not install after cancellation while the manual network check is pending', async () => {
    let finishCheck: ((value: boolean) => void) | undefined;
    const install = vi.fn();
    const manager = new SpeechAssetManager(
      await makeRoot(),
      'https://manifest.example.com/v1.json',
      {
        loadManifest: async () => manifest,
        createInstaller: () => ({ install, pause: vi.fn(), cancel: vi.fn() }),
        detectMetered: () =>
          new Promise<boolean>((resolve) => {
            finishCheck = resolve;
          }),
      },
    );
    const starting = manager.control({ tierId: 'voice-runtime', action: 'start' });
    await vi.waitFor(() => expect(finishCheck).toBeTypeOf('function'));
    await manager.control({ tierId: 'voice-runtime', action: 'cancel' });
    finishCheck?.(true);
    await starting;
    expect(install).not.toHaveBeenCalled();
  });

  it('waits for startup cleanup before installing and never repeats it during an install', async () => {
    let finishCleanup: (() => void) | undefined;
    const cleanupWorkspaces = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCleanup = resolve;
        }),
    );
    const install = vi.fn(async () => await new Promise<never>(() => undefined));
    const manager = new SpeechAssetManager(
      await makeRoot(),
      'https://manifest.example.com/v1.json',
      {
        loadManifest: async () => manifest,
        createInstaller: () => ({ install, pause: vi.fn(), cancel: vi.fn() }),
        detectMetered: async () => true,
        cleanupWorkspaces,
        delay: async () => undefined,
      },
    );
    const scheduling = manager.scheduleInitialDownload();
    const starting = manager.control({ tierId: 'voice-runtime', action: 'start' });
    await vi.waitFor(() => expect(finishCleanup).toBeTypeOf('function'));
    expect(install).not.toHaveBeenCalled();
    finishCleanup?.();
    await Promise.all([scheduling, starting]);
    await vi.waitFor(() => expect(install).toHaveBeenCalledOnce());
    await manager.scheduleInitialDownload();
    expect(cleanupWorkspaces).toHaveBeenCalledOnce();
    manager.dispose();
  });

  it.each([
    { schemaVersion: 2, expected: 'ready' },
    { schemaVersion: 1, expected: 'pending' },
    { schemaVersion: undefined, expected: 'pending' },
  ])(
    'restores only a current activation receipt after restart ($schemaVersion)',
    async ({ schemaVersion, expected }) => {
      const root = await makeRoot();
      const required = [
        'python/python.exe',
        'ireina_tts_service.py',
        'python/Lib/site-packages/bert/deberta-v2-large-japanese-char-wwm-onnx/model_fp16.onnx',
        'python/Lib/site-packages/bert/deberta-v2-large-japanese-char-wwm-onnx/config.json',
        'python/Lib/site-packages/bert/deberta-v2-large-japanese-char-wwm-onnx/tokenizer.json',
        'voice/ireina/ireina_e100_s16040.onnx',
        'voice/ireina/config.json',
        'voice/ireina/style_vectors.npy',
      ];
      for (const relativePath of required) {
        const target = path.join(root, 'voice-runtime', ...relativePath.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, 'test');
      }
      await mkdir(path.join(root, 'active'));
      await writeFile(
        path.join(root, 'active', 'voice-runtime.json'),
        JSON.stringify({ schemaVersion, version: '1.0.0', sha256: 'a'.repeat(64) }),
      );
      const manager = new SpeechAssetManager(root, 'https://manifest.example.com/v1.json', {
        loadManifest: vi.fn(async () => manifest),
      });

      await expect(manager.getStatus()).resolves.toMatchObject({
        tiers: expect.arrayContaining([
          expect.objectContaining({ id: 'voice-runtime', state: expected }),
        ]),
      });
    },
  );

  it('does not restore a marker when required runtime files are missing', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'voice-runtime', 'python'), { recursive: true });
    await writeFile(path.join(root, 'voice-runtime', 'python', 'python.exe'), 'test');
    await mkdir(path.join(root, 'active'));
    await writeFile(
      path.join(root, 'active', 'voice-runtime.json'),
      JSON.stringify({ schemaVersion: 2, version: '1.0.0', sha256: 'a'.repeat(64) }),
    );
    const manager = new SpeechAssetManager(root, 'https://manifest.example.com/v1.json', {
      loadManifest: vi.fn(async () => manifest),
    });

    await expect(manager.getStatus()).resolves.toMatchObject({
      tiers: expect.arrayContaining([
        expect.objectContaining({ id: 'voice-runtime', state: 'pending' }),
      ]),
    });
  });

  it('keeps a cancelled download pending when the old install rejects later', async () => {
    let rejectInstall: ((error: Error) => void) | undefined;
    const install = vi.fn(
      async () =>
        await new Promise<never>((_resolve, reject) => {
          rejectInstall = reject;
        }),
    );
    const manager = new SpeechAssetManager(
      await makeRoot(),
      'https://manifest.example.com/v1.json',
      {
        loadManifest: vi.fn(async () => manifest),
        createInstaller: () => ({ install, pause: vi.fn(), cancel: vi.fn() }),
      },
    );
    await manager.control({ tierId: 'voice-runtime', action: 'start' });
    await vi.waitFor(() => expect(rejectInstall).toBeTypeOf('function'));

    await manager.control({ tierId: 'voice-runtime', action: 'cancel' });
    rejectInstall?.(new Error('late failure'));
    await Promise.resolve();

    await expect(manager.getStatus()).resolves.toMatchObject({
      busy: false,
      tiers: expect.arrayContaining([
        expect.objectContaining({ id: 'voice-runtime', state: 'pending' }),
      ]),
    });
  });
});
