import { MAX_SPEECH_AUDIO_BYTES } from '../../shared/speech-ipc';
import type { SynthesizedAudio } from './openai-compatible-tts';

export interface GenieTtsRequest {
  baseUrl: string;
  characterName: string;
  text: string;
}

export interface GenieTtsAdapterOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maximumAudioBytes?: number;
}

const isLoopbackHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
};

export const resolveGenieTtsUrl = (baseUrl: string): URL => {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('Genie-TTS 地址无效。');
  }
  if (
    url.protocol !== 'http:' ||
    !isLoopbackHost(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Genie-TTS 只允许连接本机 HTTP 服务。');
  }
  const pathname = url.pathname.replace(/\/+$/gu, '');
  url.pathname = pathname.endsWith('/tts') ? pathname : `${pathname || ''}/tts`;
  return url;
};

const readBoundedAudio = async (response: Response, maximumBytes: number): Promise<Uint8Array> => {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error('Genie-TTS 返回的音频过大。');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > maximumBytes) {
    throw new Error('Genie-TTS 返回了空音频或过大音频。');
  }
  return bytes;
};

const isWave = (audio: Uint8Array): boolean =>
  audio[0] === 0x52 &&
  audio[1] === 0x49 &&
  audio[2] === 0x46 &&
  audio[3] === 0x46 &&
  audio[8] === 0x57 &&
  audio[9] === 0x41 &&
  audio[10] === 0x56 &&
  audio[11] === 0x45;

export const wrapGeniePcmAsWave = (pcm: Uint8Array): Uint8Array => {
  if (!pcm.byteLength || pcm.byteLength % 2 !== 0) {
    throw new Error('Genie-TTS 返回的裸 PCM 长度无效。');
  }
  const output = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(output.buffer);
  const writeAscii = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      output[offset + index] = value.charCodeAt(index);
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, output.byteLength - 8, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 32_000, true);
  view.setUint32(28, 32_000 * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  output.set(pcm, 44);
  return output;
};

export class GenieTtsAdapter {
  public constructor(private readonly options: GenieTtsAdapterOptions = {}) {}

  public async synthesize(
    request: GenieTtsRequest,
    signal: AbortSignal,
  ): Promise<SynthesizedAudio> {
    const characterName = request.characterName.trim();
    if (!characterName || characterName.length > 256) {
      throw new Error('Genie-TTS 角色名无效。');
    }
    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs ?? 60_000);
    const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
    let response: Response;
    try {
      response = await (this.options.fetch ?? globalThis.fetch)(
        resolveGenieTtsUrl(request.baseUrl),
        {
          method: 'POST',
          redirect: 'manual',
          headers: { 'content-type': 'application/json', accept: 'audio/wav' },
          body: JSON.stringify({
            character_name: characterName,
            text: request.text,
            split_sentence: true,
          }),
          signal: combinedSignal,
        },
      );
    } catch (error) {
      if (signal.aborted) throw new Error('Genie-TTS 生成已取消。', { cause: error });
      if (timeoutSignal.aborted) throw new Error('Genie-TTS 生成超时。', { cause: error });
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error('Genie-TTS 重定向已被安全策略拒绝。');
    }
    if (!response.ok) throw new Error(`Genie-TTS 返回错误（HTTP ${response.status}）。`);
    const contentType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (
      !['audio/wav', 'audio/x-wav', 'audio/wave', 'application/octet-stream'].includes(
        contentType ?? '',
      )
    ) {
      throw new Error('Genie-TTS 返回了不支持的内容。');
    }
    const responseAudio = await readBoundedAudio(
      response,
      Math.min(this.options.maximumAudioBytes ?? MAX_SPEECH_AUDIO_BYTES, MAX_SPEECH_AUDIO_BYTES) -
        44,
    );
    const audio = isWave(responseAudio) ? responseAudio : wrapGeniePcmAsWave(responseAudio);
    return { audio, mimeType: 'audio/wav' };
  }
}
