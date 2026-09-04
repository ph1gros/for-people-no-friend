import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  MAX_SPEECH_INPUT_AUDIO_BYTES,
  type SpeechTranscriptionInput,
} from '../../shared/speech-ipc';
import type { TranscribedSpeech } from './openai-compatible-asr';

const REQUIRED_MODEL_FILES = ['model.int8.onnx', 'tokens.txt'] as const;
const LANGUAGE_MAP: Readonly<Record<string, 'zh' | 'ja'>> = {
  zh: 'zh',
  'zh-CN': 'zh',
  ja: 'ja',
  'ja-JP': 'ja',
};

interface SherpaStream {
  acceptWaveform(input: { sampleRate: number; samples: Float32Array }): void;
}

interface SherpaRecognizer {
  createStream(): SherpaStream;
  decodeAsync(stream: SherpaStream): Promise<{ text?: unknown }>;
}

interface SherpaModule {
  OfflineRecognizer: {
    createAsync(config: Record<string, unknown>): Promise<SherpaRecognizer>;
  };
}

interface ImportedSherpaModule extends Partial<SherpaModule> {
  default?: Partial<SherpaModule>;
}

export interface LocalSherpaTranscriptionRequest extends SpeechTranscriptionInput {
  modelId: string;
  language: string;
}

export interface LocalTranscriptionAdapter {
  isAvailable(): Promise<boolean>;
  transcribe(
    request: LocalSherpaTranscriptionRequest,
    signal: AbortSignal,
  ): Promise<TranscribedSpeech>;
  dispose(): void;
}

export type SherpaModuleLoader = () => Promise<SherpaModule>;

export const normalizeSherpaModule = (loaded: ImportedSherpaModule): SherpaModule => {
  const candidate = loaded.OfflineRecognizer ? loaded : loaded.default;
  if (
    !candidate?.OfflineRecognizer ||
    typeof candidate.OfflineRecognizer.createAsync !== 'function'
  ) {
    throw new Error('本地语音识别组件无法加载。');
  }
  return candidate as SherpaModule;
};

const loadSherpaModule: SherpaModuleLoader = async () =>
  normalizeSherpaModule((await import('sherpa-onnx-node')) as unknown as ImportedSherpaModule);

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

export const resolveLocalSherpaModelRoots = ({
  appPath,
  resourcesPath,
  userDataPath,
  packaged,
}: {
  appPath: string;
  resourcesPath: string;
  userDataPath?: string;
  packaged: boolean;
}): string[] => {
  const packagedRoot = path.join(resourcesPath, 'speech-input-runtime', 'models', 'sensevoice');
  const downloadedRoot = userDataPath
    ? path.join(userDataPath, 'speech-assets', 'speech-input-runtime', 'models', 'sensevoice')
    : undefined;
  return packaged
    ? [...(downloadedRoot ? [downloadedRoot] : []), packagedRoot]
    : [
        ...(downloadedRoot ? [downloadedRoot] : []),
        packagedRoot,
        path.join(appPath, 'data', 'sensevoice-sherpa-runtime', 'models', 'sensevoice'),
      ];
};

export const resolveSafeLocalSherpaModelRoot = async (
  roots: readonly string[],
): Promise<string | undefined> => {
  for (const root of roots) {
    const [rootStats, canonicalRoot] = await Promise.all([
      lstat(root).catch(() => undefined),
      realpath(root).catch(() => undefined),
    ]);
    if (!rootStats?.isDirectory() || rootStats.isSymbolicLink() || !canonicalRoot) continue;
    let complete = true;
    for (const fileName of REQUIRED_MODEL_FILES) {
      const candidate = path.join(canonicalRoot, fileName);
      const [stats, canonical] = await Promise.all([
        lstat(candidate).catch(() => undefined),
        realpath(candidate).catch(() => undefined),
      ]);
      if (
        !stats?.isFile() ||
        stats.isSymbolicLink() ||
        !canonical ||
        !isWithin(canonicalRoot, canonical)
      ) {
        complete = false;
        break;
      }
    }
    if (complete) return canonicalRoot;
  }
  return undefined;
};

export interface PcmWave {
  sampleRate: number;
  samples: Float32Array;
}

export const parsePcm16Wave = (audio: Uint8Array): PcmWave => {
  if (audio.byteLength < 44 || audio.byteLength > MAX_SPEECH_INPUT_AUDIO_BYTES) {
    throw new Error('WAV 音频为空、过短或过大。');
  }
  const buffer = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('WAV 音频头无效。');
  }
  let offset = 12;
  let format:
    | { encoding: number; channels: number; sampleRate: number; blockAlign: number; bits: number }
    | undefined;
  let data: Buffer | undefined;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) throw new Error('WAV 音频块长度无效。');
    if (chunkId === 'fmt ' && chunkSize >= 16) {
      format = {
        encoding: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        bits: buffer.readUInt16LE(chunkStart + 14),
      };
    } else if (chunkId === 'data') {
      data = buffer.subarray(chunkStart, chunkEnd);
    }
    offset = chunkEnd + (chunkSize % 2);
  }
  if (!format || !data || data.length === 0) throw new Error('WAV 音频缺少格式或采样数据。');
  if (format.encoding !== 1 || format.bits !== 16 || ![1, 2].includes(format.channels)) {
    throw new Error('只支持单声道或双声道 16-bit PCM WAV。');
  }
  if (format.sampleRate !== 16_000) throw new Error('本地语音识别只接受 16 kHz WAV。');
  if (format.blockAlign !== format.channels * 2 || data.length % format.blockAlign !== 0) {
    throw new Error('WAV 音频采样布局无效。');
  }
  const frameCount = data.length / format.blockAlign;
  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      sum += data.readInt16LE(frame * format.blockAlign + channel * 2) / 32_768;
    }
    samples[frame] = sum / format.channels;
  }
  return { sampleRate: format.sampleRate, samples };
};

export class LocalSherpaAsrAdapter implements LocalTranscriptionAdapter {
  private module: Promise<SherpaModule> | undefined;
  private readonly recognizers = new Map<string, Promise<SherpaRecognizer>>();

  public constructor(
    private readonly modelRoots: readonly string[],
    private readonly loadModule: SherpaModuleLoader = loadSherpaModule,
  ) {}

  public async isAvailable(): Promise<boolean> {
    const root = await resolveSafeLocalSherpaModelRoot(this.modelRoots);
    if (!root) return false;
    try {
      const module = await this.getModule();
      return typeof module.OfflineRecognizer?.createAsync === 'function';
    } catch {
      return false;
    }
  }

  public async transcribe(
    request: LocalSherpaTranscriptionRequest,
    signal: AbortSignal,
  ): Promise<TranscribedSpeech> {
    if (signal.aborted) throw new Error('语音识别已取消。');
    if (
      request.modelId !== 'SenseVoiceSmall' ||
      request.mimeType !== 'audio/wav' ||
      !LANGUAGE_MAP[request.language]
    ) {
      throw new Error('本地语音识别请求无效。');
    }
    const modelRoot = await resolveSafeLocalSherpaModelRoot(this.modelRoots);
    if (!modelRoot) throw new Error('本地语音识别模型缺失或不安全。');
    const language = LANGUAGE_MAP[request.language];
    const recognizer = await this.getRecognizer(modelRoot, language);
    if (signal.aborted) throw new Error('语音识别已取消。');
    const wave = parsePcm16Wave(request.audio);
    const stream = recognizer.createStream();
    stream.acceptWaveform(wave);
    const result = await recognizer.decodeAsync(stream);
    if (signal.aborted) throw new Error('语音识别已取消。');
    const text = typeof result.text === 'string' ? result.text.trim() : '';
    if (!text || text.length > 8_000) throw new Error('本地语音识别没有返回有效文字。');
    return { text };
  }

  public dispose(): void {
    this.recognizers.clear();
    this.module = undefined;
  }

  private getModule(): Promise<SherpaModule> {
    this.module ??= this.loadModule();
    return this.module;
  }

  private getRecognizer(modelRoot: string, language: 'zh' | 'ja'): Promise<SherpaRecognizer> {
    let recognizer = this.recognizers.get(language);
    if (!recognizer) {
      recognizer = this.getModule().then((module) =>
        module.OfflineRecognizer.createAsync({
          featConfig: { sampleRate: 16_000, featureDim: 80 },
          modelConfig: {
            senseVoice: {
              model: path.join(modelRoot, 'model.int8.onnx'),
              language,
              useInverseTextNormalization: 1,
            },
            tokens: path.join(modelRoot, 'tokens.txt'),
            numThreads: Math.max(1, Math.min(4, navigatorHardwareConcurrency())),
            provider: 'cpu',
            debug: 0,
          },
        }),
      );
      this.recognizers.set(language, recognizer);
      void recognizer.catch(() => this.recognizers.delete(language));
    }
    return recognizer;
  }
}

const navigatorHardwareConcurrency = (): number => {
  const value = globalThis.navigator?.hardwareConcurrency;
  return typeof value === 'number' && Number.isFinite(value) ? value : 1;
};
