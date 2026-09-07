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
import { GENIE_VOICE_PRESETS } from '../src/shared/speech-ipc';

describe('managed Genie runtime', () => {
  it('requires language resources for Chinese and English, but keeps Japanese independent', async () => {
    vi.mocked(isSpeechAssetActivated).mockImplementation(
      async (_root, id) => id !== 'genie-language-data',
    );
    const start = vi.fn();
    const runtime = new GenieSpeechRuntime('fake-assets', { spawn: start as typeof spawn });
    expect(await runtime.resolveRoot('mika')).toBe('fake-assets');
    expect(await runtime.ensureRunning('feibi')).toBe(false);
    expect(await runtime.ensureRunning('thirtyseven')).toBe(false);
    expect(await runtime.ensureRunning('../mika')).toBe(false);
    expect(start).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it('keeps simultaneous voices on their fixed endpoints with distinct authenticated sessions', async () => {
    vi.mocked(isSpeechAssetActivated).mockResolvedValue(true);
    const children = GENIE_VOICE_PRESETS.map(() =>
      Object.assign(new EventEmitter(), { exitCode: null, killed: false, kill: vi.fn() }),
    );
    let index = 0;
    const start = vi.fn(() => children[index++] as unknown as ChildProcess);
    const runtime = new GenieSpeechRuntime('fake-assets', {
      spawn: start as typeof spawn,
      fetch: async (input) =>
        new Response(
          JSON.stringify({
            status: 'ready',
            engine: 'genie-tts',
            voice: GENIE_VOICE_PRESETS.find((p) => String(input) === p.baseUrl + '/ready')?.voiceId,
          }),
        ),
    });
    expect(
      await Promise.all(GENIE_VOICE_PRESETS.map((p) => runtime.ensureRunning(p.voiceId))),
    ).toEqual([true, true, true]);
    expect(
      new Set(GENIE_VOICE_PRESETS.map((p) => runtime.headers(p.voiceId)['x-fpnf-session'])).size,
    ).toBe(3);
    expect(start).toHaveBeenCalledTimes(3);
    expect(await runtime.ensureRunning('feibi')).toBe(true);
    expect(start).toHaveBeenCalledTimes(3);
    runtime.dispose();
    for (const child of children) expect(child.kill).toHaveBeenCalledOnce();
  });
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
