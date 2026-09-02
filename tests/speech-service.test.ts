import { describe, expect, it, vi } from 'vitest';

import type {
  OpenAICompatibleSpeechAdapter,
  OpenAICompatibleSpeechRequest,
} from '../src/adapters/speech/openai-compatible-tts';
import type {
  OpenAICompatibleTranscriptionAdapter,
  OpenAICompatibleTranscriptionRequest,
} from '../src/adapters/speech/openai-compatible-asr';
import { normalizeJapaneseSpeechText, SpeechService } from '../src/main/speech/speech-service';
import type { SecretStore } from '../src/main/security/secret-store';
import type { SpeechConfigStore } from '../src/main/storage/speech-config-store';
import { BUNDLED_IREINA_SPEECH_PRESET, type SpeechSettings } from '../src/shared/speech-ipc';

const enabledSettings = (): SpeechSettings => ({
  enabled: true,
  providerId: 'openai-compatible',
  baseUrl: 'http://127.0.0.1:8000/v1',
  modelId: 'fake-tts-model',
  voiceId: 'fake-voice',
  language: 'zh-CN',
  responseFormat: 'wav',
  speed: 1,
  volume: 0.6,
  inputEnabled: true,
  inputMode: 'manual',
  wakeWordSource: 'character-name',
  customWakeWord: '',
  pushToTalkKey: 'F8',
  transcriptionBaseUrl: 'http://127.0.0.1:9880/v1',
  transcriptionModelId: 'SenseVoiceSmall',
  transcriptionLanguage: 'zh-CN',
});

describe('speech service', () => {
  it('removes spoken ellipses and spells isolated Latin letters in Japanese', () => {
    expect(
      normalizeJapaneseSpeechText("……式は f'(c) = (f(b) - f(a)) / (b - a)。……これで終わり。"),
    ).toBe('式は エフダッシュ(シー) = (エフ(ビー) - エフ(エー)) / (ビー - エー)。これで終わり。');
    expect(normalizeJapaneseSpeechText('少し……考える。')).toBe('少し、考える。');
  });

  it('keeps provider capability and secret state explicit without exposing the secret', async () => {
    let settings = enabledSettings();
    const service = new SpeechService(
      {
        get: async () => ({ ...settings }),
        set: async (next: SpeechSettings) => {
          settings = { ...next };
        },
      } as SpeechConfigStore,
      {
        has: async () => true,
        get: async () => 'fake-key',
        set: async () => undefined,
        delete: async () => undefined,
      } as unknown as SecretStore,
      {
        synthesize: async () => ({ audio: new Uint8Array([1]), mimeType: 'audio/wav' }),
      } as OpenAICompatibleSpeechAdapter,
      {
        transcribe: async () => ({ text: '你好。' }),
      } as OpenAICompatibleTranscriptionAdapter,
      undefined,
      undefined,
      {},
      async () => true,
    );

    await expect(service.getStatus()).resolves.toMatchObject({
      apiKeySaved: true,
      output: { available: true, dataDestination: 'this-device' },
      input: {
        available: true,
        dataDestination: 'this-device',
        modes: ['full', 'half', 'manual'],
      },
    });
    expect(JSON.stringify(await service.getStatus())).not.toContain('fake-key');
    await expect(service.setSettings({ ...settings, enabled: false })).resolves.toEqual({
      ok: true,
    });
  });

  it('does not advertise local speech input when the configured service is not reachable', async () => {
    const service = new SpeechService(
      { get: async () => enabledSettings(), set: async () => undefined } as SpeechConfigStore,
      { get: async () => undefined, has: async () => false } as unknown as SecretStore,
      {
        synthesize: async () => ({ audio: new Uint8Array([1]), mimeType: 'audio/wav' }),
      } as OpenAICompatibleSpeechAdapter,
      {
        transcribe: async () => ({ text: '不应调用。' }),
      } as OpenAICompatibleTranscriptionAdapter,
      undefined,
      undefined,
      {},
      async () => false,
    );

    await expect(service.getStatus()).resolves.toMatchObject({
      input: {
        available: false,
        modes: [],
        dataDestination: 'this-device',
        detail: '本机语音识别服务未安装或未启动；文字聊天和语音输出不受影响。',
      },
    });
  });

  it('starts an optional local input runtime before probing continuous-listening readiness', async () => {
    let runtimeStarted = false;
    const ensureInputRuntime = vi.fn(async () => {
      runtimeStarted = true;
      return true;
    });
    const probeInputReadiness = vi.fn(async () => runtimeStarted);
    const service = new SpeechService(
      {
        get: async () => ({ ...enabledSettings(), inputMode: 'full' }),
        set: async () => undefined,
      } as SpeechConfigStore,
      { get: async () => undefined, has: async () => false } as unknown as SecretStore,
      {
        synthesize: async () => ({ audio: new Uint8Array([1]), mimeType: 'audio/wav' }),
      } as OpenAICompatibleSpeechAdapter,
      {
        transcribe: async () => ({ text: '你好。' }),
      } as OpenAICompatibleTranscriptionAdapter,
      undefined,
      undefined,
      {},
      probeInputReadiness,
      ensureInputRuntime,
    );

    await expect(service.getStatus()).resolves.toMatchObject({
      input: { available: true, modes: ['full', 'half', 'manual'] },
    });
    expect(ensureInputRuntime).toHaveBeenCalledOnce();
    expect(probeInputReadiness).toHaveBeenCalledOnce();
  });

  it('does not advertise the bundled local voice before its model is ready', async () => {
    const ensureBundledRuntime = vi.fn(async () => false);
    const service = new SpeechService(
      {
        get: async () => ({
          ...enabledSettings(),
          ...BUNDLED_IREINA_SPEECH_PRESET,
        }),
        set: async () => undefined,
      } as SpeechConfigStore,
      { get: async () => undefined, has: async () => false } as unknown as SecretStore,
      {
        synthesize: async () => ({ audio: new Uint8Array([1]), mimeType: 'audio/wav' }),
      } as OpenAICompatibleSpeechAdapter,
      undefined,
      undefined,
      ensureBundledRuntime,
    );

    await expect(service.getStatus()).resolves.toMatchObject({
      output: {
        available: false,
        detail: '本机 Style-Bert-VITS2 运行时未就绪；文字回复仍可正常使用。',
      },
    });
    expect(ensureBundledRuntime).toHaveBeenCalledOnce();
  });

  it('sends bounded WAV input to transcription and returns text without exposing audio', async () => {
    const requests: OpenAICompatibleTranscriptionRequest[] = [];
    const service = new SpeechService(
      { get: async () => enabledSettings(), set: async () => undefined } as SpeechConfigStore,
      { get: async () => undefined, has: async () => false } as unknown as SecretStore,
      {
        synthesize: async () => ({ audio: new Uint8Array([1]), mimeType: 'audio/wav' }),
      } as OpenAICompatibleSpeechAdapter,
      {
        transcribe: async (request: OpenAICompatibleTranscriptionRequest) => {
          requests.push(request);
          return { text: '你好，这是测试。' };
        },
      } as OpenAICompatibleTranscriptionAdapter,
    );

    await expect(
      service.transcribe({
        requestId: 'asr_1',
        audio: new Uint8Array([82, 73, 70, 70]),
        mimeType: 'audio/wav',
      }),
    ).resolves.toEqual({ ok: true, requestId: 'asr_1', text: '你好，这是测试。' });
    expect(requests[0]).toMatchObject({
      baseUrl: 'http://127.0.0.1:9880/v1',
      modelId: 'SenseVoiceSmall',
      language: 'zh-CN',
    });
  });

  it('passes only validated configuration to synthesis and cancels in-flight work', async () => {
    const requests: OpenAICompatibleSpeechRequest[] = [];
    let release: (() => void) | undefined;
    const adapter = {
      synthesize: async (request: OpenAICompatibleSpeechRequest, signal: AbortSignal) => {
        requests.push(request);
        await new Promise<void>((resolve, reject) => {
          release = resolve;
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        });
        return { audio: new Uint8Array([82, 73, 70, 70]), mimeType: 'audio/wav' };
      },
    } as OpenAICompatibleSpeechAdapter;
    const service = new SpeechService(
      {
        get: async () => ({ ...enabledSettings(), language: 'ja-JP' }),
        set: async () => undefined,
      } as SpeechConfigStore,
      {
        has: async () => true,
        get: async () => 'fake-key',
      } as unknown as SecretStore,
      adapter,
      undefined,
      async () => 'こんにちは。',
    );

    const pending = service.synthesize({ requestId: 'speech_1', text: '你好。' });
    for (let attempts = 0; attempts < 10 && requests.length === 0; attempts += 1) {
      await Promise.resolve();
    }
    expect(requests).toHaveLength(1);
    expect(service.cancel('speech_1')).toBe(true);
    await expect(pending).resolves.toMatchObject({ ok: false, cancelled: true });
    expect(requests[0]).toMatchObject({
      apiKey: 'fake-key',
      modelId: 'fake-tts-model',
      voiceId: 'fake-voice',
      text: 'こんにちは。',
    });
    release?.();
  });
});
