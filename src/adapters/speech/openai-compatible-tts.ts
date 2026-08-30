import {
  MAX_SPEECH_AUDIO_BYTES,
  SPEECH_AUDIO_FORMATS,
  type SpeechAudioFormat,
} from '../../shared/speech-ipc';

export interface OpenAICompatibleSpeechRequest {
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  voiceId: string;
  responseFormat: SpeechAudioFormat;
  speed: number;
  text: string;
}

export interface SynthesizedAudio {
  audio: Uint8Array;
  mimeType: string;
}

export interface OpenAICompatibleSpeechAdapterOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maximumAudioBytes?: number;
}

const MIME_TYPE_BY_FORMAT: Readonly<Record<SpeechAudioFormat, string>> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  opus: 'audio/opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
};

const ALLOWED_AUDIO_MIME_TYPES = new Set<string>([
  ...Object.values(MIME_TYPE_BY_FORMAT),
  'audio/x-wav',
  'audio/wave',
  'application/octet-stream',
]);

const isLoopbackHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
};

export const resolveSpeechSynthesisUrl = (baseUrl: string): URL => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('语音兼容接口地址无效。');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('语音兼容接口地址不能包含账号、查询参数或片段。');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
    throw new Error('远端语音接口必须使用 HTTPS；HTTP 只允许本机地址。');
  }
  const pathname = url.pathname.replace(/\/+$/gu, '');
  url.pathname = pathname.endsWith('/audio/speech') ? pathname : `${pathname || ''}/audio/speech`;
  return url;
};

export const speechDataDestination = (baseUrl: string): 'this-device' | 'remote-service' =>
  isLoopbackHost(resolveSpeechSynthesisUrl(baseUrl).hostname) ? 'this-device' : 'remote-service';

const readBoundedAudio = async (response: Response, maximumBytes: number): Promise<Uint8Array> => {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error('语音服务返回的音频过大。');
  }
  if (!response.body) throw new Error('语音服务没有返回音频。');
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
        throw new Error('语音服务返回的音频过大。');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new Error('语音服务返回了空音频。');
  const audio = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return audio;
};

const hasPrefix = (audio: Uint8Array, prefix: readonly number[], offset = 0): boolean =>
  prefix.every((value, index) => audio[offset + index] === value);

export const hasExpectedAudioSignature = (
  audio: Uint8Array,
  format: SpeechAudioFormat,
): boolean => {
  switch (format) {
    case 'wav':
      return (
        hasPrefix(audio, [0x52, 0x49, 0x46, 0x46]) && hasPrefix(audio, [0x57, 0x41, 0x56, 0x45], 8)
      );
    case 'mp3':
      return (
        hasPrefix(audio, [0x49, 0x44, 0x33]) ||
        (audio[0] === 0xff && audio[1] !== undefined && (audio[1] & 0xe0) === 0xe0)
      );
    case 'opus':
      return hasPrefix(audio, [0x4f, 0x67, 0x67, 0x53]);
    case 'aac':
      return audio[0] === 0xff && audio[1] !== undefined && (audio[1] & 0xf6) === 0xf0;
    case 'flac':
      return hasPrefix(audio, [0x66, 0x4c, 0x61, 0x43]);
  }
};

export class OpenAICompatibleSpeechAdapter {
  public constructor(private readonly options: OpenAICompatibleSpeechAdapterOptions = {}) {}

  public async synthesize(
    request: OpenAICompatibleSpeechRequest,
    signal: AbortSignal,
  ): Promise<SynthesizedAudio> {
    const endpoint = resolveSpeechSynthesisUrl(request.baseUrl);
    if (
      !request.modelId.trim() ||
      request.modelId.length > 256 ||
      !request.voiceId.trim() ||
      request.voiceId.length > 256 ||
      !SPEECH_AUDIO_FORMATS.includes(request.responseFormat) ||
      !Number.isFinite(request.speed) ||
      request.speed < 0.25 ||
      request.speed > 4
    ) {
      throw new Error('语音模型配置无效。');
    }
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs ?? 60_000);
    const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
    let response: Response;
    try {
      response = await (this.options.fetch ?? globalThis.fetch)(endpoint, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/json',
          accept: MIME_TYPE_BY_FORMAT[request.responseFormat],
          ...(request.apiKey?.trim() ? { authorization: `Bearer ${request.apiKey.trim()}` } : {}),
        },
        body: JSON.stringify({
          model: request.modelId.trim(),
          voice: request.voiceId.trim(),
          input: request.text,
          response_format: request.responseFormat,
          speed: request.speed,
        }),
        signal: combinedSignal,
      });
    } catch (error) {
      if (signal.aborted) throw new Error('语音生成已取消。', { cause: error });
      if (timeoutSignal.aborted) throw new Error('语音生成超时。', { cause: error });
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error('语音服务重定向已被安全策略拒绝。');
    }
    if (!response.ok) {
      throw new Error(`语音服务返回错误（HTTP ${response.status}）。`);
    }
    const rawMimeType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (!rawMimeType || !ALLOWED_AUDIO_MIME_TYPES.has(rawMimeType)) {
      throw new Error('语音服务返回了不支持的音频格式。');
    }
    const audio = await readBoundedAudio(
      response,
      Math.min(this.options.maximumAudioBytes ?? MAX_SPEECH_AUDIO_BYTES, MAX_SPEECH_AUDIO_BYTES),
    );
    if (!hasExpectedAudioSignature(audio, request.responseFormat)) {
      throw new Error('语音服务返回的音频签名与请求格式不一致。');
    }
    return {
      audio,
      mimeType:
        rawMimeType === 'application/octet-stream'
          ? MIME_TYPE_BY_FORMAT[request.responseFormat]
          : rawMimeType,
    };
  }
}
