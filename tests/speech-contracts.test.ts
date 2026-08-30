import { describe, expect, it } from 'vitest';

import type { SpeechAudioChunk, SpeechOutput } from '../src/core/speech/contracts';
import { SpeechTurnCoordinator } from '../src/core/speech/contracts';
import {
  parseCancelSpeechInput,
  parseSetSpeechSecretInput,
  parseSpeechSettings,
  parseSpeechSynthesisInput,
  parseSpeechTranscriptionInput,
} from '../src/shared/speech-ipc';

class FakeSpeechOutput implements SpeechOutput {
  public stopped = 0;

  public async *synthesize(text: string): AsyncIterable<SpeechAudioChunk> {
    yield { audio: new Uint8Array([1]), mimeType: 'audio/fake', text };
  }

  public async stop(): Promise<void> {
    this.stopped += 1;
  }
}

describe('speech contracts', () => {
  it('streams fake audio and keeps stopping safe when speech is unavailable', async () => {
    const output = new FakeSpeechOutput();
    const coordinator = new SpeechTurnCoordinator(output);
    const chunks: SpeechAudioChunk[] = [];
    await expect(
      coordinator.speak('你好', async (chunk) => {
        chunks.push(chunk);
      }),
    ).resolves.toBe(true);
    expect(chunks[0]?.text).toBe('你好');
    await expect(coordinator.stop()).resolves.toBeUndefined();
    expect(output.stopped).toBeGreaterThan(0);
  });

  it('validates bounded speech settings, secrets and request IDs', () => {
    expect(
      parseSpeechSettings({
        enabled: true,
        providerId: 'openai-compatible',
        baseUrl: ' http://127.0.0.1:8000/v1 ',
        modelId: ' fake-model ',
        voiceId: ' fake-voice ',
        language: 'zh-CN',
        responseFormat: 'wav',
        speed: 1,
      }),
    ).toMatchObject({
      enabled: true,
      baseUrl: 'http://127.0.0.1:8000/v1',
      modelId: 'fake-model',
      voiceId: 'fake-voice',
      volume: 0.6,
      inputMode: 'manual',
      pushToTalkKey: 'F8',
    });
    expect(parseSpeechSynthesisInput({ requestId: 'speech_1', text: ' 你好。 ' })).toEqual({
      requestId: 'speech_1',
      text: '你好。',
    });
    expect(
      parseSpeechTranscriptionInput({
        requestId: 'asr_1',
        audio: new Uint8Array([82, 73, 70, 70]),
        mimeType: 'audio/wav',
      }),
    ).toMatchObject({ requestId: 'asr_1', mimeType: 'audio/wav' });
    expect(parseCancelSpeechInput({ requestId: 'speech_1' })).toEqual({ requestId: 'speech_1' });
    expect(parseSetSpeechSecretInput({ apiKey: 'fake-key' })).toEqual({ apiKey: 'fake-key' });
    expect(() =>
      parseSpeechSettings({
        enabled: true,
        providerId: 'disabled',
        baseUrl: 'http://127.0.0.1:8000/v1',
        modelId: '',
        voiceId: '',
        language: 'zh-CN',
        responseFormat: 'wav',
        speed: 1,
      }),
    ).toThrow();
    expect(() => parseSpeechSynthesisInput({ requestId: '../bad', text: 'x' })).toThrow();
    expect(() =>
      parseSpeechSettings({
        enabled: false,
        providerId: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:8000/v1',
        modelId: '',
        voiceId: '',
        language: 'zh-CN',
        responseFormat: 'wav',
        speed: 1,
        inputMode: 'always',
      }),
    ).toThrow();
    expect(() =>
      parseSpeechSettings({
        enabled: false,
        providerId: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:8000/v1',
        modelId: '',
        voiceId: '',
        language: 'zh-CN',
        responseFormat: 'wav',
        speed: 1,
        pushToTalkKey: 'A',
      }),
    ).toThrow();
    expect(() =>
      parseSpeechSettings({
        enabled: true,
        providerId: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:8000/v1',
        modelId: 'fake-model',
        voiceId: 'fake-voice',
        language: 'zh-CN',
        responseFormat: 'wav',
        speed: 1,
        volume: 1.1,
      }),
    ).toThrow();
    expect(() =>
      parseSpeechTranscriptionInput({
        requestId: 'asr_1',
        audio: new Uint8Array(),
        mimeType: 'audio/webm',
      }),
    ).toThrow();
    expect(() => parseSetSpeechSecretInput({ apiKey: '********' })).toThrow();
  });
});
