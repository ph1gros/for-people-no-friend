import { describe, expect, it, vi } from 'vitest';

import {
  SOCIAL_ASR_SAMPLE_RATE,
  SOCIAL_QQ_VOICE_SAMPLE_RATE,
  bytesToPcmSamples,
  encodeWavPcm16,
  isSupportedVoiceSampleRate,
  parseWavPcm16,
  pcmSamplesToBytes,
  resamplePcm16,
  voiceDurationMs,
} from '../src/core/social/social-voice';
import {
  SocialVoiceCodec,
  stripAmrHeader,
  type SocialSilkModule,
} from '../src/main/social/social-voice-codec';

const tone = (frames: number, sampleRate: number, hz = 440): Int16Array => {
  const samples = new Int16Array(frames);
  for (let index = 0; index < frames; index += 1) {
    samples[index] = Math.round(Math.sin((2 * Math.PI * hz * index) / sampleRate) * 12_000);
  }
  return samples;
};

const wavWithExtraChunk = (sampleRate: number, samples: Int16Array): Uint8Array => {
  const note = new TextEncoder().encode('made-by-test0000');
  const dataBytes = samples.length * 2;
  const total = 12 + 24 + (8 + note.length) + (8 + dataBytes);
  const output = new Uint8Array(total);
  const view = new DataView(output.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, total - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'LIST');
  view.setUint32(40, note.length, true);
  output.set(note, 44);
  const dataStart = 44 + note.length;
  ascii(dataStart, 'data');
  view.setUint32(dataStart + 4, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(dataStart + 8 + index * 2, samples[index] as number, true);
  }
  return output;
};

const stereoWav = (sampleRate: number, left: Int16Array, right: Int16Array): Uint8Array => {
  const frames = Math.min(left.length, right.length);
  const dataBytes = frames * 4;
  const output = new Uint8Array(44 + dataBytes);
  const view = new DataView(output.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let frame = 0; frame < frames; frame += 1) {
    view.setInt16(44 + frame * 4, left[frame] as number, true);
    view.setInt16(44 + frame * 4 + 2, right[frame] as number, true);
  }
  return output;
};

describe('social voice conversions', () => {
  it('round-trips mono audio through the WAV container', () => {
    const samples = tone(960, SOCIAL_QQ_VOICE_SAMPLE_RATE);
    const parsed = parseWavPcm16(
      encodeWavPcm16({ sampleRate: SOCIAL_QQ_VOICE_SAMPLE_RATE, samples }),
    );

    expect(parsed.sampleRate).toBe(SOCIAL_QQ_VOICE_SAMPLE_RATE);
    expect([...parsed.samples]).toEqual([...samples]);
    expect(voiceDurationMs(parsed)).toBe(40);
  });

  it('averages channels and skips chunks it does not need', () => {
    const stereo = parseWavPcm16(
      stereoWav(16_000, Int16Array.from([100, -200]), Int16Array.from([300, 400])),
    );
    expect([...stereo.samples]).toEqual([200, 100]);

    const samples = tone(320, 16_000);
    const extra = parseWavPcm16(wavWithExtraChunk(16_000, samples));
    expect(extra.sampleRate).toBe(16_000);
    expect([...extra.samples]).toEqual([...samples]);
  });

  it('rejects malformed, non-PCM and truncated containers', () => {
    expect(() => parseWavPcm16(new Uint8Array(10))).toThrow();
    expect(() => parseWavPcm16(new Uint8Array(64))).toThrow();

    const compressed = encodeWavPcm16({ sampleRate: 16_000, samples: tone(64, 16_000) });
    new DataView(compressed.buffer).setUint16(20, 3, true);
    expect(() => parseWavPcm16(compressed)).toThrow();

    const wrongBits = encodeWavPcm16({ sampleRate: 16_000, samples: tone(64, 16_000) });
    new DataView(wrongBits.buffer).setUint16(34, 24, true);
    expect(() => parseWavPcm16(wrongBits)).toThrow();

    const badRate = encodeWavPcm16({ sampleRate: 16_000, samples: tone(64, 16_000) });
    new DataView(badRate.buffer).setUint32(24, 96_000, true);
    expect(() => parseWavPcm16(badRate)).toThrow();
  });

  it('refuses to build a container from empty or out-of-range audio', () => {
    expect(() => encodeWavPcm16({ sampleRate: 16_000, samples: new Int16Array(0) })).toThrow();
    expect(() => encodeWavPcm16({ sampleRate: 96_000, samples: tone(10, 16_000) })).toThrow();
    expect(isSupportedVoiceSampleRate(16_000)).toBe(true);
    expect(isSupportedVoiceSampleRate(96_000)).toBe(false);
    expect(isSupportedVoiceSampleRate(16_000.5)).toBe(false);
  });

  it('resamples 24 kHz down to the rate the recognizer requires', () => {
    const source = { sampleRate: 24_000, samples: tone(2_400, 24_000) };
    const target = resamplePcm16(source, SOCIAL_ASR_SAMPLE_RATE);

    expect(target.sampleRate).toBe(SOCIAL_ASR_SAMPLE_RATE);
    expect(target.samples.length).toBe(1_600);
    expect(voiceDurationMs(target)).toBe(voiceDurationMs(source));
    expect(target.samples.some((value) => value !== 0)).toBe(true);
  });

  it('returns the same audio when no conversion is needed and upsamples otherwise', () => {
    const source = { sampleRate: 16_000, samples: tone(160, 16_000) };
    expect(resamplePcm16(source, 16_000)).toBe(source);

    const up = resamplePcm16(source, 24_000);
    expect(up.sampleRate).toBe(24_000);
    expect(up.samples.length).toBe(240);
  });

  it('serializes samples little-endian regardless of host order', () => {
    const samples = Int16Array.from([0, 1, -1, 32_767, -32_768]);
    const bytes = pcmSamplesToBytes(samples);

    expect([...bytes.slice(0, 4)]).toEqual([0, 0, 1, 0]);
    expect([...bytesToPcmSamples(bytes)]).toEqual([...samples]);
    expect(() => bytesToPcmSamples(new Uint8Array(1))).toThrow();
  });
});

const fakeSilk = (overrides: Partial<SocialSilkModule> = {}): SocialSilkModule => ({
  isSilk: (data) => data.byteLength > 0 && data[0] === 0x02,
  decode: async (input, sampleRate) => {
    void input;
    const samples = tone(sampleRate / 10, sampleRate);
    return { data: pcmSamplesToBytes(samples), duration: 100 };
  },
  encode: async (input) => ({ data: Uint8Array.from([0x02, ...input.slice(0, 8)]), duration: 250 }),
  ...overrides,
});

const silkPayload = (): Uint8Array => Uint8Array.from([0x02, 0x23, 0x21, 0x53, 0x49, 0x4c, 0x4b]);

describe('social voice codec', () => {
  it('reports unavailable and degrades to undefined when the optional module is missing', async () => {
    const codec = new SocialVoiceCodec(async () => undefined);

    expect(await codec.isAvailable()).toBe(false);
    expect(await codec.decodeToWav(silkPayload())).toBeUndefined();
    expect(
      await codec.encodeFromWav(encodeWavPcm16({ sampleRate: 24_000, samples: tone(240, 24_000) })),
    ).toBeUndefined();
  });

  it('survives a loader that throws', async () => {
    const codec = new SocialVoiceCodec(async () => {
      throw new Error('module blew up');
    });

    expect(await codec.isAvailable()).toBe(false);
    expect(await codec.decodeToWav(silkPayload())).toBeUndefined();
  });

  it('decodes a voice note into 16 kHz WAV for the recognizer', async () => {
    const codec = new SocialVoiceCodec(async () => fakeSilk());
    const wav = await codec.decodeToWav(silkPayload());

    expect(wav).toBeInstanceOf(Uint8Array);
    const parsed = parseWavPcm16(wav as Uint8Array);
    expect(parsed.sampleRate).toBe(SOCIAL_ASR_SAMPLE_RATE);
    expect(parsed.samples.length).toBeGreaterThan(0);
  });

  it('encodes synthesized speech into a SILK clip with a duration', async () => {
    const codec = new SocialVoiceCodec(async () => fakeSilk());
    const clip = await codec.encodeFromWav(
      encodeWavPcm16({ sampleRate: 16_000, samples: tone(1_600, 16_000) }),
    );

    expect(clip?.data[0]).toBe(0x02);
    expect(clip?.durationMs).toBe(250);
  });

  it('falls back to the measured duration when the encoder does not report one', async () => {
    const codec = new SocialVoiceCodec(async () =>
      fakeSilk({ encode: async () => ({ data: Uint8Array.from([0x02, 0x00]), duration: 0 }) }),
    );
    const clip = await codec.encodeFromWav(
      encodeWavPcm16({ sampleRate: 24_000, samples: tone(24_000, 24_000) }),
    );

    expect(clip?.durationMs).toBe(1_000);
  });

  it('rejects payloads that are empty, oversized or not SILK at all', async () => {
    const codec = new SocialVoiceCodec(async () => fakeSilk());

    expect(await codec.decodeToWav(new Uint8Array(0))).toBeUndefined();
    expect(await codec.decodeToWav(new Uint8Array(5 * 1_048_576))).toBeUndefined();
    expect(await codec.decodeToWav(Uint8Array.from([0x99, 0x01]))).toBeUndefined();
    expect(await codec.encodeFromWav(Uint8Array.from([1, 2, 3]))).toBeUndefined();
  });

  it('never lets a codec failure escape as an exception', async () => {
    const codec = new SocialVoiceCodec(async () =>
      fakeSilk({
        decode: async () => {
          throw new Error('decoder exploded');
        },
      }),
    );

    await expect(codec.decodeToWav(silkPayload())).resolves.toBeUndefined();
  });

  it('probes the optional module only once', async () => {
    const load = vi.fn(async () => fakeSilk());
    const codec = new SocialVoiceCodec(load);

    await codec.isAvailable();
    await codec.decodeToWav(silkPayload());
    await codec.encodeFromWav(encodeWavPcm16({ sampleRate: 16_000, samples: tone(160, 16_000) }));

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('strips an AMR banner before handing frames to the decoder', () => {
    const body = Uint8Array.from([0x02, 0x11, 0x22]);
    const banner = new TextEncoder().encode('#!AMR\n');
    const combined = new Uint8Array(banner.length + body.length);
    combined.set(banner);
    combined.set(body, banner.length);

    expect([...stripAmrHeader(combined)]).toEqual([...body]);
    expect([...stripAmrHeader(body)]).toEqual([...body]);
  });
});
