export interface VoiceActivitySegmenterOptions {
  threshold?: number;
  preRollMs?: number;
  minimumVoiceMs?: number;
  silenceMs?: number;
  maximumUtteranceMs?: number;
}

const rmsLevel = (samples: Float32Array): number => {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length));
};

const concatenateSamples = (frames: readonly Float32Array[]): Float32Array => {
  const length = frames.reduce((sum, frame) => sum + frame.length, 0);
  const output = new Float32Array(length);
  let offset = 0;
  for (const frame of frames) {
    output.set(frame, offset);
    offset += frame.length;
  }
  return output;
};

export class VoiceActivitySegmenter {
  private readonly threshold: number;
  private readonly preRollMs: number;
  private readonly minimumVoiceMs: number;
  private readonly silenceMs: number;
  private readonly maximumUtteranceMs: number;
  private preRoll: Float32Array[] = [];
  private preRollSamples = 0;
  private utterance: Float32Array[] | undefined;
  private utteranceSamples = 0;
  private voicedSamples = 0;
  private silentSamples = 0;

  public constructor(options: VoiceActivitySegmenterOptions = {}) {
    this.threshold = options.threshold ?? 0.018;
    this.preRollMs = options.preRollMs ?? 240;
    this.minimumVoiceMs = options.minimumVoiceMs ?? 180;
    this.silenceMs = options.silenceMs ?? 720;
    this.maximumUtteranceMs = options.maximumUtteranceMs ?? 12_000;
  }

  public get hearing(): boolean {
    return Boolean(this.utterance);
  }

  public push(samples: Float32Array, sampleRate: number): Float32Array | undefined {
    if (samples.length === 0 || sampleRate <= 0) return undefined;
    const frame = samples.slice();
    const voiced = rmsLevel(frame) >= this.threshold;
    if (!this.utterance) {
      this.pushPreRoll(frame, sampleRate);
      if (!voiced) return undefined;
      this.utterance = this.preRoll;
      this.utteranceSamples = this.preRollSamples;
      this.preRoll = [];
      this.preRollSamples = 0;
    } else {
      this.utterance.push(frame);
      this.utteranceSamples += frame.length;
    }

    if (voiced) {
      this.voicedSamples += frame.length;
      this.silentSamples = 0;
    } else {
      this.silentSamples += frame.length;
    }
    const milliseconds = (samples: number): number => (samples / sampleRate) * 1_000;
    const reachedSilence = milliseconds(this.silentSamples) >= this.silenceMs;
    const reachedMaximum = milliseconds(this.utteranceSamples) >= this.maximumUtteranceMs;
    if (
      (reachedSilence && milliseconds(this.voicedSamples) >= this.minimumVoiceMs) ||
      reachedMaximum
    ) {
      return this.finish();
    }
    return undefined;
  }

  public reset(): void {
    this.preRoll = [];
    this.preRollSamples = 0;
    this.utterance = undefined;
    this.utteranceSamples = 0;
    this.voicedSamples = 0;
    this.silentSamples = 0;
  }

  private pushPreRoll(frame: Float32Array, sampleRate: number): void {
    this.preRoll.push(frame);
    this.preRollSamples += frame.length;
    const maximumSamples = Math.ceil((sampleRate * this.preRollMs) / 1_000);
    while (this.preRollSamples > maximumSamples && this.preRoll.length > 1) {
      this.preRollSamples -= this.preRoll.shift()?.length ?? 0;
    }
  }

  private finish(): Float32Array {
    const result = concatenateSamples(this.utterance ?? []);
    this.reset();
    return result;
  }
}

export const resampleMonoPcm = (
  input: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array => {
  if (sourceRate === targetRate) return input.slice();
  const outputLength = Math.max(1, Math.round((input.length * targetRate) / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < output.length; index += 1) {
    const position = index * ratio;
    const left = Math.min(input.length - 1, Math.floor(position));
    const right = Math.min(input.length - 1, left + 1);
    const mix = position - left;
    output[index] = (input[left] ?? 0) * (1 - mix) + (input[right] ?? 0) * mix;
  }
  return output;
};

export const encodeMonoPcmWav = (samples: Float32Array, sampleRate: number): Uint8Array => {
  const output = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(output);
  const writeAscii = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, output.byteLength - 8, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Uint8Array(output);
};

export type ContinuousListenerState = 'listening' | 'hearing' | 'processing';

export interface ContinuousUtteranceTiming {
  startedAt: number;
  endedAt: number;
}

export interface ContinuousMicrophoneListenerOptions {
  onUtterance(audio: Uint8Array, timing: ContinuousUtteranceTiming): Promise<void>;
  onState(state: ContinuousListenerState): void;
  onError(message: string): void;
}

const TARGET_SAMPLE_RATE = 16_000;

export class ContinuousMicrophoneListener {
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private processor?: ScriptProcessorNode;
  private mute?: GainNode;
  private segmenter = new VoiceActivitySegmenter();
  private processing = Promise.resolve();
  private utteranceStartedAt?: number;
  private utteranceLastVoicedAt?: number;

  public constructor(private readonly options: ContinuousMicrophoneListenerOptions) {}

  public get active(): boolean {
    return Boolean(this.stream);
  }

  public async start(): Promise<void> {
    if (this.active) return;
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Microphone capture is unavailable.');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    const context = new AudioContext();
    if (context.state === 'suspended') await context.resume();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(2_048, 1, 1);
    const mute = context.createGain();
    mute.gain.value = 0;
    processor.onaudioprocess = (event) => {
      const capturedAt = Date.now();
      const samples = event.inputBuffer.getChannelData(0);
      const before = this.segmenter.hearing;
      const voiced = rmsLevel(samples) >= 0.018;
      const utterance = this.segmenter.push(samples, event.inputBuffer.sampleRate);
      if (!before && this.segmenter.hearing) {
        this.utteranceStartedAt = capturedAt;
        this.options.onState('hearing');
      }
      if (this.segmenter.hearing && voiced) this.utteranceLastVoicedAt = capturedAt;
      if (!utterance) return;
      const audio = encodeMonoPcmWav(
        resampleMonoPcm(utterance, event.inputBuffer.sampleRate, TARGET_SAMPLE_RATE),
        TARGET_SAMPLE_RATE,
      );
      const timing: ContinuousUtteranceTiming = {
        startedAt: this.utteranceStartedAt ?? capturedAt,
        endedAt: this.utteranceLastVoicedAt ?? capturedAt,
      };
      this.utteranceStartedAt = undefined;
      this.utteranceLastVoicedAt = undefined;
      this.processing = this.processing
        .then(async () => {
          if (!this.active) return;
          this.options.onState('processing');
          await this.options.onUtterance(audio, timing);
          if (this.active) this.options.onState('listening');
        })
        .catch(() => {
          if (this.active) this.options.onError('持续监听处理失败；已经暂停监听。');
          void this.stop();
        });
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
    this.stream = stream;
    this.context = context;
    this.source = source;
    this.processor = processor;
    this.mute = mute;
    this.options.onState('listening');
  }

  public async stop(): Promise<void> {
    this.segmenter.reset();
    this.utteranceStartedAt = undefined;
    this.utteranceLastVoicedAt = undefined;
    if (this.processor) this.processor.onaudioprocess = null;
    this.source?.disconnect();
    this.processor?.disconnect();
    this.mute?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    const context = this.context;
    this.stream = undefined;
    this.context = undefined;
    this.source = undefined;
    this.processor = undefined;
    this.mute = undefined;
    if (context && context.state !== 'closed') await context.close().catch(() => undefined);
  }
}
