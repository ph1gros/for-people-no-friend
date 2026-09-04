import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GenieTtsAdapter,
  resolveGenieTtsUrl,
  wrapGeniePcmAsWave,
} from '../src/adapters/speech/genie-tts';
import { startFakeHttpServer, type FakeHttpServer } from './helpers/fake-http-server';

const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
const rawPcm = new Uint8Array([0, 0, 1, 0]);

describe('Genie-TTS provider', () => {
  it('bounds an undeclared stream and authenticates only through the Main callback', async () => {
    const cancel = vi.fn();
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(65));
            },
            cancel,
          }),
          { headers: { 'content-type': 'application/octet-stream' } },
        ),
    );
    const adapter = new GenieTtsAdapter({
      fetch: fetcher,
      maximumAudioBytes: 108,
      prepareLocal: async () => ({ 'x-fpnf-session': 'fake-session' }),
    });
    await expect(
      adapter.synthesize(
        { baseUrl: 'http://127.0.0.1:9882', characterName: 'mika', text: 'test' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('过大');
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-fpnf-session': 'fake-session' }),
      }),
    );
  });
  let server: FakeHttpServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('accepts only loopback HTTP and posts the bounded character request', async () => {
    let requestBody = '';
    server = await startFakeHttpServer((request, response) => {
      request.on('data', (chunk) => (requestBody += String(chunk)));
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'audio/wav' });
        response.end(wav);
      });
    });
    const result = await new GenieTtsAdapter().synthesize(
      {
        baseUrl: server.baseUrl,
        characterName: 'private-test-character',
        text: 'Hello.',
      },
      new AbortController().signal,
    );
    expect(JSON.parse(requestBody)).toEqual({
      character_name: 'private-test-character',
      text: 'Hello.',
      split_sentence: true,
    });
    expect(result).toEqual({ audio: wav, mimeType: 'audio/wav' });
    expect(() => resolveGenieTtsUrl('https://example.com')).toThrow(/只允许连接本机/u);
  });

  it('wraps the upstream raw 32 kHz PCM stream as a browser-decodable WAV', async () => {
    server = await startFakeHttpServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'audio/wav' });
      response.end(rawPcm);
    });
    const result = await new GenieTtsAdapter().synthesize(
      { baseUrl: server.baseUrl, characterName: 'voice', text: 'test' },
      new AbortController().signal,
    );
    expect(result.audio).toEqual(wrapGeniePcmAsWave(rawPcm));
    expect(new TextDecoder().decode(result.audio.slice(0, 4))).toBe('RIFF');
    expect(new DataView(result.audio.buffer).getUint32(24, true)).toBe(32_000);
  });
});
