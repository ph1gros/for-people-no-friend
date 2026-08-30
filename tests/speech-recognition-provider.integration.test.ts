import { afterEach, describe, expect, it } from 'vitest';

import {
  OpenAICompatibleTranscriptionAdapter,
  resolveSpeechTranscriptionUrl,
  transcriptionDataDestination,
} from '../src/adapters/speech/openai-compatible-asr';
import { startFakeHttpServer, type FakeHttpServer } from './helpers/fake-http-server';

describe('OpenAI-compatible speech recognition provider', () => {
  let server: FakeHttpServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('sends bounded WAV audio to a local transcription endpoint', async () => {
    let requestPath = '';
    let contentType = '';
    let body = '';
    server = await startFakeHttpServer((request, response) => {
      void (async () => {
        requestPath = request.url ?? '';
        contentType = request.headers['content-type'] ?? '';
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        body = Buffer.concat(chunks).toString('latin1');
        const payload = Buffer.from(JSON.stringify({ text: '你好。' }));
        response.writeHead(200, {
          'content-type': 'application/json',
          'content-length': String(payload.byteLength),
        });
        response.end(payload);
      })();
    });

    const result = await new OpenAICompatibleTranscriptionAdapter().transcribe(
      {
        requestId: 'asr_1',
        baseUrl: `${server.baseUrl}/v1`,
        modelId: 'SenseVoiceSmall',
        language: 'zh-CN',
        audio: new Uint8Array([82, 73, 70, 70]),
        mimeType: 'audio/wav',
      },
      new AbortController().signal,
    );

    expect(requestPath).toBe('/v1/audio/transcriptions');
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/u);
    expect(body).toContain('SenseVoiceSmall');
    expect(body).toContain('recording.wav');
    expect(result).toEqual({ text: '你好。' });
  });

  it('rejects remote plaintext and classifies data destinations', () => {
    expect(() => resolveSpeechTranscriptionUrl('http://example.com/v1')).toThrow(/HTTPS/u);
    expect(transcriptionDataDestination('http://127.0.0.1:9880/v1')).toBe('this-device');
    expect(transcriptionDataDestination('https://speech.example.com/v1')).toBe('remote-service');
  });
});
