import { describe, expect, it } from 'vitest';

import { FishAudioSpeechAdapter } from '../src/adapters/speech/fish-audio-tts';

const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0]);

describe('Fish Audio provider', () => {
  it('uses the fixed official endpoint and does not put the secret in the body', async () => {
    let seenUrl = '';
    let seenHeaders: Headers | undefined;
    let seenBody = '';
    const adapter = new FishAudioSpeechAdapter({
      fetch: async (input, init) => {
        seenUrl = String(input);
        seenHeaders = new Headers(init?.headers);
        seenBody = String(init?.body);
        return new Response(mp3, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
      },
    });
    const result = await adapter.synthesize(
      {
        apiKey: 'fake-fish-key',
        modelId: 's2-pro',
        referenceId: 'private_voice_1',
        responseFormat: 'mp3',
        speed: 1,
        text: 'Hello.',
      },
      new AbortController().signal,
    );
    expect(seenUrl).toBe('https://api.fish.audio/v1/tts');
    expect(seenHeaders?.get('authorization')).toBe('Bearer fake-fish-key');
    expect(seenHeaders?.get('model')).toBe('s2-pro');
    expect(JSON.parse(seenBody)).toMatchObject({
      text: 'Hello.',
      reference_id: 'private_voice_1',
      format: 'mp3',
    });
    expect(seenBody).not.toContain('fake-fish-key');
    expect(result).toEqual({ audio: mp3, mimeType: 'audio/mpeg' });
  });
});
