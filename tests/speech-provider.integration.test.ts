import { afterEach, describe, expect, it } from 'vitest';

import {
  OpenAICompatibleSpeechAdapter,
  resolveSpeechSynthesisUrl,
  speechDataDestination,
} from '../src/adapters/speech/openai-compatible-tts';
import { readJsonBody, startFakeHttpServer, type FakeHttpServer } from './helpers/fake-http-server';

describe('OpenAI-compatible speech provider', () => {
  let server: FakeHttpServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('sends bounded synthesis input to a local compatible endpoint', async () => {
    let requestPath = '';
    let authorization = '';
    let body: unknown;
    server = await startFakeHttpServer((request, response) => {
      void (async () => {
        requestPath = request.url ?? '';
        authorization = request.headers.authorization ?? '';
        body = await readJsonBody(request);
        response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': '12' });
        response.end(Buffer.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]));
      })();
    });

    const adapter = new OpenAICompatibleSpeechAdapter();
    const result = await adapter.synthesize(
      {
        baseUrl: `${server.baseUrl}/v1`,
        apiKey: 'fake-speech-key',
        modelId: 'fake-tts-model',
        voiceId: 'fake-voice',
        responseFormat: 'wav',
        speed: 1.1,
        text: '你好。',
      },
      new AbortController().signal,
    );

    expect(requestPath).toBe('/v1/audio/speech');
    expect(authorization).toBe('Bearer fake-speech-key');
    expect(body).toEqual({
      model: 'fake-tts-model',
      voice: 'fake-voice',
      input: '你好。',
      response_format: 'wav',
      speed: 1.1,
    });
    expect(result).toEqual({
      audio: new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]),
      mimeType: 'audio/wav',
    });
  });

  it('rejects remote plaintext, redirects, non-audio data and oversized bodies', async () => {
    expect(() => resolveSpeechSynthesisUrl('http://example.com/v1')).toThrow(/HTTPS/u);
    expect(() => resolveSpeechSynthesisUrl('https://user@example.com/v1')).toThrow(/账号/u);
    expect(speechDataDestination('http://127.0.0.1:8000/v1')).toBe('this-device');
    expect(speechDataDestination('https://speech.example.com/v1')).toBe('remote-service');

    server = await startFakeHttpServer((request, response) => {
      if (request.url?.includes('redirect')) {
        response.writeHead(307, { location: '/v1/audio/speech' });
      } else if (request.url?.includes('oversize')) {
        response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': '12' });
      } else {
        response.writeHead(200, { 'content-type': 'application/json' });
      }
      response.end('{}');
    });
    const adapter = new OpenAICompatibleSpeechAdapter({ maximumAudioBytes: 1 });
    const baseRequest = {
      apiKey: undefined,
      modelId: 'fake-model',
      voiceId: 'fake-voice',
      responseFormat: 'wav' as const,
      speed: 1,
      text: 'test',
    };
    await expect(
      adapter.synthesize(
        { ...baseRequest, baseUrl: `${server.baseUrl}/redirect` },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/重定向/u);
    await expect(
      adapter.synthesize({ ...baseRequest, baseUrl: server.baseUrl }, new AbortController().signal),
    ).rejects.toThrow(/音频格式/u);
    await expect(
      adapter.synthesize(
        { ...baseRequest, baseUrl: `${server.baseUrl}/oversize` },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/音频过大/u);
  });
});
