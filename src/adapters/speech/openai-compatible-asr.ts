import {
  MAX_SPEECH_INPUT_AUDIO_BYTES,
  SPEECH_INPUT_MIME_TYPES,
  type SpeechTranscriptionInput,
} from '../../shared/speech-ipc';

export interface OpenAICompatibleTranscriptionRequest extends SpeechTranscriptionInput {
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  language: string;
}

export interface TranscribedSpeech {
  text: string;
}

export interface OpenAICompatibleTranscriptionAdapterOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maximumResponseBytes?: number;
}

const isLoopbackHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
};

export const resolveSpeechTranscriptionUrl = (baseUrl: string): URL => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('语音识别接口地址无效。');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('语音识别接口地址不能包含账号、查询参数或片段。');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
    throw new Error('远端语音识别接口必须使用 HTTPS；HTTP 只允许本机地址。');
  }
  const pathname = url.pathname.replace(/\/+$/gu, '');
  url.pathname = pathname.endsWith('/audio/transcriptions')
    ? pathname
    : `${pathname || ''}/audio/transcriptions`;
  return url;
};

export const transcriptionDataDestination = (baseUrl: string): 'this-device' | 'remote-service' =>
  isLoopbackHost(resolveSpeechTranscriptionUrl(baseUrl).hostname)
    ? 'this-device'
    : 'remote-service';

export class OpenAICompatibleTranscriptionAdapter {
  public constructor(private readonly options: OpenAICompatibleTranscriptionAdapterOptions = {}) {}

  public async transcribe(
    request: OpenAICompatibleTranscriptionRequest,
    signal: AbortSignal,
  ): Promise<TranscribedSpeech> {
    if (
      !request.modelId.trim() ||
      request.modelId.length > 256 ||
      !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/u.test(request.language) ||
      !SPEECH_INPUT_MIME_TYPES.includes(request.mimeType) ||
      request.audio.byteLength === 0 ||
      request.audio.byteLength > MAX_SPEECH_INPUT_AUDIO_BYTES
    ) {
      throw new Error('语音识别请求无效。');
    }
    const endpoint = resolveSpeechTranscriptionUrl(request.baseUrl);
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs ?? 60_000);
    const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
    const body = new FormData();
    body.set('model', request.modelId.trim());
    body.set('language', request.language.trim());
    body.set(
      'file',
      new Blob([Uint8Array.from(request.audio).buffer], { type: request.mimeType }),
      'recording.wav',
    );
    let response: Response;
    try {
      response = await (this.options.fetch ?? globalThis.fetch)(endpoint, {
        method: 'POST',
        redirect: 'manual',
        headers: request.apiKey?.trim()
          ? { authorization: `Bearer ${request.apiKey.trim()}` }
          : undefined,
        body,
        signal: combinedSignal,
      });
    } catch (error) {
      if (signal.aborted) throw new Error('语音识别已取消。', { cause: error });
      if (timeoutSignal.aborted) throw new Error('语音识别超时。', { cause: error });
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error('语音识别服务重定向已被安全策略拒绝。');
    }
    if (!response.ok) {
      throw new Error(`语音识别服务返回错误（HTTP ${response.status}）。`);
    }
    const contentType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== 'application/json') {
      throw new Error('语音识别服务返回了不支持的数据格式。');
    }
    const declaredLength = Number(response.headers.get('content-length'));
    const maximumResponseBytes = Math.min(this.options.maximumResponseBytes ?? 65_536, 65_536);
    if (Number.isFinite(declaredLength) && declaredLength > maximumResponseBytes) {
      throw new Error('语音识别服务返回的数据过大。');
    }
    const raw = new Uint8Array(await response.arrayBuffer());
    if (raw.byteLength === 0 || raw.byteLength > maximumResponseBytes) {
      throw new Error('语音识别服务返回的数据为空或过大。');
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(raw)) as unknown;
    } catch {
      throw new Error('语音识别服务返回了无效 JSON。');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('语音识别服务返回内容无效。');
    }
    const text = (value as Record<string, unknown>).text;
    if (typeof text !== 'string' || !text.trim() || text.length > 8_000) {
      throw new Error('语音识别服务没有返回有效文字。');
    }
    return { text: text.trim() };
  }
}
