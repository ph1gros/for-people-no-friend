import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { ChildProcess, spawn } from 'node:child_process';
import { GenieSpeechRuntime } from '../src/main/speech/genie-speech-runtime';

vi.mock('../src/main/speech/speech-asset-activation', () => ({
  isSpeechAssetActivated: vi.fn(async () => false),
}));
vi.mock('../src/main/speech/speech-asset-downloader', () => ({
  validateInstalledSpeechAssetTarget: vi.fn(async () => undefined),
}));
import { isSpeechAssetActivated } from '../src/main/speech/speech-asset-activation';

describe('managed Genie runtime', () => {
  it('does not execute incomplete or unapproved components, including development resources', async () => {
    vi.mocked(isSpeechAssetActivated).mockResolvedValue(false);
    const start = vi.fn();
    const runtime = new GenieSpeechRuntime('fake-assets', {
      spawn: start as typeof spawn,
      developmentAssetsRoot: 'fake-development-assets',
    });
    expect(await runtime.ensureRunning()).toBe(false);
    expect(start).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it('shares startup, authenticates readiness, and stops its own child on disposal', async () => {
    vi.mocked(isSpeechAssetActivated).mockResolvedValue(true);
    const child = Object.assign(new EventEmitter(), {
      exitCode: null,
      killed: false,
      kill: vi.fn(),
    });
    const start = vi.fn(() => child as unknown as ChildProcess);
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: 'ready', engine: 'genie-tts', voice: 'mika' })),
    );
    const runtime = new GenieSpeechRuntime('fake-assets', {
      spawn: start as typeof spawn,
      fetch: fetcher,
    });
    expect(await Promise.all([runtime.ensureRunning(), runtime.ensureRunning()])).toEqual([
      true,
      true,
    ]);
    expect(start).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:9882/ready',
      expect.objectContaining({ headers: runtime.headers(), redirect: 'error' }),
    );
    expect(start.mock.calls[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          windowsHide: true,
          stdio: 'ignore',
          env: expect.objectContaining({
            FPNF_GENIE_SESSION_TOKEN: runtime.headers()['x-fpnf-session'],
          }),
        }),
      ]),
    );
    runtime.dispose();
    expect(child.kill).toHaveBeenCalledOnce();
    expect(await runtime.ensureRunning()).toBe(false);
  });

  it('rejects a different voice or oversized readiness response and terminates failed startup', async () => {
    vi.mocked(isSpeechAssetActivated).mockResolvedValue(true);
    for (const body of [
      JSON.stringify({ status: 'ready', engine: 'genie-tts', voice: 'other' }),
      'x'.repeat(1025),
    ]) {
      const child = Object.assign(new EventEmitter(), {
        exitCode: null,
        killed: false,
        kill: vi.fn(),
      });
      const runtime = new GenieSpeechRuntime('fake-assets', {
        spawn: vi.fn(() => child) as unknown as typeof spawn,
        fetch: async () => new Response(body),
        attempts: 1,
        delay: async () => undefined,
      });
      expect(await runtime.ensureRunning()).toBe(false);
      expect(child.kill).toHaveBeenCalledOnce();
      runtime.dispose();
    }
  });
});
