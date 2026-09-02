import { describe, expect, it, vi } from 'vitest';

import { probeLoopbackSpeechService } from '../src/main/speech/loopback-speech-service-probe';

describe('loopback speech service probe', () => {
  it('treats any local HTTP response as reachable without sending credentials or audio', async () => {
    const fetchLocal = vi.fn(async () => new Response(null, { status: 404 }));

    await expect(
      probeLoopbackSpeechService('http://127.0.0.1:9880/v1/audio/transcriptions', fetchLocal),
    ).resolves.toBe(true);
    expect(fetchLocal).toHaveBeenCalledWith(
      'http://127.0.0.1:9880/health',
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
  });

  it('rejects remote hosts and reports a refused local connection as unavailable', async () => {
    const fetchLocal = vi.fn(async () => {
      throw new Error('connection refused');
    });

    await expect(probeLoopbackSpeechService('http://127.0.0.1:9880/v1', fetchLocal)).resolves.toBe(
      false,
    );
    await expect(
      probeLoopbackSpeechService('https://speech.example.com/v1', fetchLocal),
    ).resolves.toBe(false);
  });
});
