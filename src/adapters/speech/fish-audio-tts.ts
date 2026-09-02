import { MAX_SPEECH_AUDIO_BYTES, type SpeechAudioFormat } from '../../shared/speech-ipc';
import { hasExpectedAudioSignature, type SynthesizedAudio } from './openai-compatible-tts';

export const FISH_AUDIO_BASE_URL = 'https://api.fish.audio';
const FISH_MODELS = new Set(['s1', 's2-pro']);
const FISH_FORMATS = new Set<SpeechAudioFormat>(['wav', 'mp3', 'opus']);

export interface FishAudioSpeechRequest {
  apiKey?: string;
  modelId: string;
  referenceId: string;
  responseFormat: SpeechAudioFormat;
  speed: number;
  text: string;
}

export interface FishAudioSpeechAdapterOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maximumAudioBytes?: number;
}

const MIME_TYPE_BY_FORMAT: Readonly<Record<'wav' | 'mp3' | 'opus', string>> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  opus: 'audio/opus',
};

const readBoundedAudio = async (response: Response, maximumBytes: number): Promise<Uint8Array> => {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error('Fish Audio 返回的音频过大。');
  }
  if (!response.body) throw new Error('Fish Audio 没有返回音频。');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error('Fish Audio 返回的音频过大。');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) throw new Error('Fish Audio 返回了空音频。');
  const audio = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return audio;
};

export class FishAudioSpeechAdapter {
  public constructor(private readonly options: FishAudioSpeechAdapterOptions = {}) {}

  public async synthesize(
    request: FishAudioSpeechRequest,
    signal: AbortSignal,
  ): Promise<SynthesizedAudio> {
    const apiKey = request.apiKey?.trim();
    const modelId = request.modelId.trim();
    const referenceId = request.referenceId.trim();
    if (!apiKey) throw new Error('Fish Audio API Key 尚未配置。');
    if (!FISH_MODELS.has(modelId)) throw new Error('Fish Audio 模型只允许 s1 或 s2-pro。');
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(referenceId)) {
      throw new Error('Fish Audio 音色 ID 无效。');
    }
    if (!FISH_FORMATS.has(request.responseFormat)) {
      throw new Error('Fish Audio 只支持 WAV、MP3 或 Opus 输出。');
    }
    if (!Number.isFinite(request.speed) || request.speed < 0.5 || request.speed > 2) {
      throw new Error('Fish Audio 语速必须在 0.5 到 2 之间。');
    }
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs ?? 60_000);
    const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
    let response: Response;
    try {
      response = await (this.options.fetch ?? globalThis.fetch)(`${FISH_AUDIO_BASE_URL}/v1/tts`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: MIME_TYPE_BY_FORMAT[request.responseFormat as 'wav' | 'mp3' | 'opus'],
          model: modelId,
        },
        body: JSON.stringify({
          text: request.text,
          reference_id: referenceId,
          format: request.responseFormat,
          normalize: true,
          latency: 'balanced',
          prosody: { speed: request.speed, volume: 0, normalize_loudness: true },
        }),
        signal: combinedSignal,
      });
    } catch (error) {
      if (signal.aborted) throw new Error('Fish Audio 生成已取消。', { cause: error });
      if (timeoutSignal.aborted) throw new Error('Fish Audio 生成超时。', { cause: error });
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error('Fish Audio 重定向已被安全策略拒绝。');
    }
    if (!response.ok) throw new Error(`Fish Audio 返回错误（HTTP ${response.status}）。`);
    const responseMimeType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    const expectedMimeType = MIME_TYPE_BY_FORMAT[request.responseFormat as 'wav' | 'mp3' | 'opus'];
    if (responseMimeType !== expectedMimeType && responseMimeType !== 'application/octet-stream') {
      throw new Error('Fish Audio 返回了不支持的内容类型。');
    }
    const audio = await readBoundedAudio(
      response,
      Math.min(this.options.maximumAudioBytes ?? MAX_SPEECH_AUDIO_BYTES, MAX_SPEECH_AUDIO_BYTES),
    );
    if (!hasExpectedAudioSignature(audio, request.responseFormat)) {
      throw new Error('Fish Audio 返回的音频签名与请求格式不一致。');
    }
    return {
      audio,
      mimeType: expectedMimeType,
    };
  }
}
