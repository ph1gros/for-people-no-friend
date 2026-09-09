/** Sample rate the bundled local recognizer requires. */
export const SOCIAL_ASR_SAMPLE_RATE = 16_000;

/** Sample rate QQ expects for SILK voice messages. */
export const SOCIAL_QQ_VOICE_SAMPLE_RATE = 24_000;

export const SOCIAL_MIN_VOICE_SAMPLE_RATE = 8_000;
export const SOCIAL_MAX_VOICE_SAMPLE_RATE = 48_000;

/** Bounds decoded audio so a hostile payload cannot expand into unbounded memory. */
export const SOCIAL_MAX_VOICE_FRAMES = SOCIAL_MAX_VOICE_SAMPLE_RATE * 300;

const WAV_HEADER_BYTES = 44;
const RIFF = 0x52494646;
const WAVE = 0x57415645;
const FMT_ = 0x666d7420;
const DATA = 0x64617461;

/** Mono signed 16-bit PCM. Every conversion in this module normalizes to this shape. */
export interface SocialPcmAudio {
  sampleRate: number;
  samples: Int16Array;
}

const invalid = (): never => {
  throw new Error('The voice payload is invalid.');
};

export const isSupportedVoiceSampleRate = (value: number): boolean =>
  Number.isInteger(value) &&
  value >= SOCIAL_MIN_VOICE_SAMPLE_RATE &&
  value <= SOCIAL_MAX_VOICE_SAMPLE_RATE;

export const voiceDurationMs = (audio: SocialPcmAudio): number =>
  Math.round((audio.samples.length / audio.sampleRate) * 1_000);

/**
 * Parses a PCM WAV file into mono 16-bit samples, averaging multi-channel input. Chunks other
 * than `fmt ` and `data` are skipped, which is what real encoders emit (LIST, fact, ...).
 */
export const parseWavPcm16 = (data: Uint8Array): SocialPcmAudio => {
  if (!(data instanceof Uint8Array) || data.byteLength < WAV_HEADER_BYTES) invalid();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, false) !== RIFF || view.getUint32(8, false) !== WAVE) invalid();

  let format: { channels: number; sampleRate: number; bits: number } | undefined;
  let body: { start: number; length: number } | undefined;
  let cursor = 12;
  while (cursor + 8 <= data.byteLength) {
    const id = view.getUint32(cursor, false);
    const size = view.getUint32(cursor + 4, true);
    const start = cursor + 8;
    if (size > data.byteLength - start) break;
    if (id === FMT_ && size >= 16) {
      if (view.getUint16(start, true) !== 1) invalid();
      format = {
        channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        bits: view.getUint16(start + 14, true),
      };
    } else if (id === DATA) {
      body = { start, length: size };
    }
    cursor = start + size + (size % 2);
  }

  if (
    !format ||
    !body ||
    body.length === 0 ||
    format.bits !== 16 ||
    format.channels < 1 ||
    format.channels > 8 ||
    !isSupportedVoiceSampleRate(format.sampleRate)
  ) {
    invalid();
  }

  const { channels, sampleRate } = format as { channels: number; sampleRate: number };
  const blockAlign = channels * 2;
  const frames = Math.floor((body as { length: number }).length / blockAlign);
  if (frames === 0 || frames > SOCIAL_MAX_VOICE_FRAMES) invalid();

  const start = (body as { start: number }).start;
  const samples = new Int16Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += view.getInt16(start + frame * blockAlign + channel * 2, true);
    }
    samples[frame] = Math.round(sum / channels);
  }
  return { sampleRate, samples };
};

/** Wraps mono 16-bit samples in a canonical 44-byte WAV header. */
export const encodeWavPcm16 = (audio: SocialPcmAudio): Uint8Array => {
  if (
    !audio ||
    !(audio.samples instanceof Int16Array) ||
    audio.samples.length === 0 ||
    audio.samples.length > SOCIAL_MAX_VOICE_FRAMES ||
    !isSupportedVoiceSampleRate(audio.sampleRate)
  ) {
    invalid();
  }
  const dataBytes = audio.samples.length * 2;
  const output = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(output.buffer);
  view.setUint32(0, RIFF, false);
  view.setUint32(4, 36 + dataBytes, true);
  view.setUint32(8, WAVE, false);
  view.setUint32(12, FMT_, false);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, DATA, false);
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < audio.samples.length; index += 1) {
    view.setInt16(WAV_HEADER_BYTES + index * 2, audio.samples[index] as number, true);
  }
  return output;
};

/**
 * Resamples mono audio. Downsampling first applies a box low-pass over the source window, which
 * keeps aliasing out of the recognizer without pulling in a filter-design dependency.
 */
export const resamplePcm16 = (audio: SocialPcmAudio, targetRate: number): SocialPcmAudio => {
  if (!isSupportedVoiceSampleRate(targetRate)) invalid();
  if (audio.sampleRate === targetRate) return audio;

  const ratio = audio.sampleRate / targetRate;
  const frames = Math.max(1, Math.floor(audio.samples.length / ratio));
  if (frames > SOCIAL_MAX_VOICE_FRAMES) invalid();
  const samples = new Int16Array(frames);
  const window = ratio > 1 ? Math.floor(ratio) : 1;

  for (let index = 0; index < frames; index += 1) {
    const position = index * ratio;
    if (window > 1) {
      const start = Math.min(audio.samples.length - 1, Math.round(position));
      let sum = 0;
      let count = 0;
      for (let offset = 0; offset < window && start + offset < audio.samples.length; offset += 1) {
        sum += audio.samples[start + offset] as number;
        count += 1;
      }
      samples[index] = Math.round(sum / Math.max(1, count));
      continue;
    }
    const lower = Math.floor(position);
    const upper = Math.min(audio.samples.length - 1, lower + 1);
    const weight = position - lower;
    const left = audio.samples[lower] as number;
    const right = audio.samples[upper] as number;
    samples[index] = Math.round(left + (right - left) * weight);
  }
  return { sampleRate: targetRate, samples };
};

/** Serializes mono samples to little-endian bytes regardless of host byte order. */
export const pcmSamplesToBytes = (samples: Int16Array): Uint8Array => {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(index * 2, samples[index] as number, true);
  }
  return bytes;
};

/** Reads little-endian 16-bit samples produced by a decoder. */
export const bytesToPcmSamples = (bytes: Uint8Array): Int16Array => {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2) invalid();
  const frames = Math.floor(bytes.byteLength / 2);
  if (frames > SOCIAL_MAX_VOICE_FRAMES) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Int16Array(frames);
  for (let index = 0; index < frames; index += 1) {
    samples[index] = view.getInt16(index * 2, true);
  }
  return samples;
};
