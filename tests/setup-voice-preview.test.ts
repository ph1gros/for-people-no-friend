import { describe, expect, it, vi } from 'vitest';

import { SetupVoicePreviewService } from '../src/main/setup/setup-voice-preview';
import { parsePreviewSetupVoiceInput } from '../src/shared/setup-ipc';
import type { SetupVoice } from '../src/core/setup/setup-flow';

const audio = new Uint8Array([82, 73, 70, 70]);

const build = (
  overrides: Partial<{
    installed: boolean;
    running: boolean;
    synthesize: (
      request: { baseUrl: string; characterName: string; text: string },
      signal: AbortSignal,
    ) => Promise<{ audio: Uint8Array; mimeType: string }>;
  }> = {},
) => {
  const seen: Array<{ baseUrl: string; characterName: string; text: string }> = [];
  const started: string[] = [];
  const service = new SetupVoicePreviewService({
    isInstalled: async () => overrides.installed ?? true,
    ensureRunning: async (voiceId) => {
      started.push(voiceId);
      return overrides.running ?? true;
    },
    synthesize:
      overrides.synthesize ??
      (async (request) => {
        seen.push(request);
        return { audio, mimeType: 'audio/wav' };
      }),
  });
  return { service, seen, started };
};

describe('setup voice preview', () => {
  it('speaks each managed voice on its own endpoint, in its own language', async () => {
    for (const [voice, voiceId, port] of [
      ['genie', 'mika', 9882],
      ['genie-feibi', 'feibi', 9883],
      ['genie-thirtyseven', 'thirtyseven', 9884],
    ] as const) {
      const { service, seen, started } = build();
      const result = await service.preview(voice, new AbortController().signal);
      expect(result.ok, voice).toBe(true);
      expect(result.reason).toBe('played');
      expect(started).toEqual([voiceId]);
      expect(seen[0].characterName).toBe(voiceId);
      expect(seen[0].baseUrl).toContain(String(port));
      expect(seen[0].text.length).toBeGreaterThan(0);
    }
  });

  it('never lets the renderer choose what is spoken', () => {
    // The wizard window exists before the user has agreed to anything; a preview that accepted
    // text would make it a text-to-speech endpoint.
    expect(() => parsePreviewSetupVoiceInput({ voice: 'genie', text: '任意文本' })).toThrow();
    expect(() => parsePreviewSetupVoiceInput({ voice: 'not-a-voice' })).toThrow();
    expect(() => parsePreviewSetupVoiceInput('genie')).toThrow();
    expect(parsePreviewSetupVoiceInput({ voice: 'genie-feibi' })).toEqual({ voice: 'genie-feibi' });
  });

  it('reports rather than throws when the voice is not installed', async () => {
    const { service, started } = build({ installed: false });
    const result = await service.preview('genie', new AbortController().signal);
    expect(result).toEqual({
      ok: false,
      reason: 'not-installed',
      message: '组件尚未全部校验通过，暂时无法试听。',
    });
    // Nothing is started for a voice that has no verified assets.
    expect(started).toEqual([]);
  });

  it('reports rather than throws when the local service will not start', async () => {
    const { service } = build({ running: false });
    const result = await service.preview('genie', new AbortController().signal);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unavailable');
  });

  it('turns a synthesis failure into a message instead of a rejection', async () => {
    const { service } = build({
      synthesize: async () => {
        throw new Error('boom');
      },
    });
    const result = await service.preview('genie', new AbortController().signal);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('failed');
    expect(result.message).toBeDefined();
  });

  it('reports a cancelled preview separately so the wizard shows no error', async () => {
    const { service } = build({
      synthesize: (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    });
    const pending = service.preview('genie', new AbortController().signal);
    service.stop();
    const result = await pending;
    expect(result).toEqual({ ok: false, reason: 'cancelled' });
  });

  it('cancels a running preview when another one starts', async () => {
    let aborts = 0;
    let started = false;
    const { service } = build({
      synthesize: (_request, signal) =>
        new Promise((resolve) => {
          started = true;
          signal.addEventListener(
            'abort',
            () => {
              aborts += 1;
              resolve({ audio, mimeType: 'audio/wav' });
            },
            { once: true },
          );
          setTimeout(() => resolve({ audio, mimeType: 'audio/wav' }), 50);
        }),
    });
    const first = service.preview('genie', new AbortController().signal);
    await vi.waitFor(() => expect(started).toBe(true), { interval: 1 });
    const second = service.preview('genie-feibi', new AbortController().signal);
    const results = await Promise.all([first, second]);
    expect(results[0]).toEqual({ ok: false, reason: 'cancelled' });
    expect(results[1].ok).toBe(true);
    expect(aborts).toBe(1);
  });

  it('refuses a voice that has no managed preview', async () => {
    const { service } = build();
    for (const voice of ['none', 'ireina'] as SetupVoice[]) {
      const result = await service.preview(voice, new AbortController().signal);
      expect(result.ok, voice).toBe(false);
      expect(result.reason).toBe('unsupported');
    }
  });
});
