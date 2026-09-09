import {
  SOCIAL_ASR_SAMPLE_RATE,
  SOCIAL_MAX_VOICE_FRAMES,
  SOCIAL_QQ_VOICE_SAMPLE_RATE,
  bytesToPcmSamples,
  encodeWavPcm16,
  parseWavPcm16,
  pcmSamplesToBytes,
  resamplePcm16,
  voiceDurationMs,
} from '../../core/social/social-voice';

/** The slice of `silk-wasm` the voice path uses. Declared locally so the module stays swappable. */
export interface SocialSilkModule {
  isSilk(data: Uint8Array): boolean;
  encode(input: Uint8Array, sampleRate: number): Promise<{ data: Uint8Array; duration: number }>;
  decode(input: Uint8Array, sampleRate: number): Promise<{ data: Uint8Array; duration: number }>;
}

export type SocialSilkLoader = () => Promise<SocialSilkModule | undefined>;

/**
 * Kept well inside the 1 MB QQ payload cap: the clip travels as base64, which adds a third. A
 * minute of SILK speech is a few hundred kilobytes, so this only rejects pathological input.
 */
export const SOCIAL_MAX_SILK_BYTES = 512 * 1_024;

/**
 * `silk-wasm` is an optional dependency. A missing or broken module must never take down text
 * chat, so the loader resolves to undefined and every conversion degrades to "unsupported".
 */
const loadSilkWasm: SocialSilkLoader = async () => {
  try {
    const module = (await import('silk-wasm')) as Partial<SocialSilkModule>;
    return typeof module.encode === 'function' &&
      typeof module.decode === 'function' &&
      typeof module.isSilk === 'function'
      ? (module as SocialSilkModule)
      : undefined;
  } catch {
    return undefined;
  }
};

export interface SocialVoiceClip {
  data: Uint8Array;
  durationMs: number;
}

/**
 * Converts between the SILK payloads QQ exchanges and the PCM WAV the speech stack understands.
 * Everything stays in memory: a voice note from a social platform is never written to disk.
 */
export class SocialVoiceCodec {
  private module?: SocialSilkModule;
  private probed?: Promise<SocialSilkModule | undefined>;

  public constructor(private readonly load: SocialSilkLoader = loadSilkWasm) {}

  /** True once the optional codec is present. Callers use it to advertise adapter capabilities. */
  public async isAvailable(): Promise<boolean> {
    return (await this.resolve()) !== undefined;
  }

  /** SILK or AMR voice note to 16 kHz mono WAV, the format the bundled recognizer requires. */
  public async decodeToWav(voice: Uint8Array): Promise<Uint8Array | undefined> {
    if (!(voice instanceof Uint8Array) || voice.byteLength === 0) return undefined;
    if (voice.byteLength > SOCIAL_MAX_SILK_BYTES) return undefined;
    const silk = await this.resolve();
    if (!silk) return undefined;
    try {
      const payload = stripAmrHeader(voice);
      if (!silk.isSilk(payload)) return undefined;
      const decoded = await silk.decode(payload, SOCIAL_QQ_VOICE_SAMPLE_RATE);
      if (!decoded?.data?.byteLength || decoded.data.byteLength / 2 > SOCIAL_MAX_VOICE_FRAMES) {
        return undefined;
      }
      const pcm = {
        sampleRate: SOCIAL_QQ_VOICE_SAMPLE_RATE,
        samples: bytesToPcmSamples(decoded.data),
      };
      return encodeWavPcm16(resamplePcm16(pcm, SOCIAL_ASR_SAMPLE_RATE));
    } catch {
      return undefined;
    }
  }

  /** Synthesized WAV to a 24 kHz SILK clip QQ accepts as a native voice message. */
  public async encodeFromWav(wav: Uint8Array): Promise<SocialVoiceClip | undefined> {
    if (!(wav instanceof Uint8Array) || wav.byteLength === 0) return undefined;
    const silk = await this.resolve();
    if (!silk) return undefined;
    try {
      const pcm = resamplePcm16(parseWavPcm16(wav), SOCIAL_QQ_VOICE_SAMPLE_RATE);
      const encoded = await silk.encode(
        pcmSamplesToBytes(pcm.samples),
        SOCIAL_QQ_VOICE_SAMPLE_RATE,
      );
      if (!encoded?.data?.byteLength || encoded.data.byteLength > SOCIAL_MAX_SILK_BYTES) {
        return undefined;
      }
      const durationMs =
        Number.isFinite(encoded.duration) && encoded.duration > 0
          ? Math.round(encoded.duration)
          : voiceDurationMs(pcm);
      return { data: encoded.data, durationMs };
    } catch {
      return undefined;
    }
  }

  private async resolve(): Promise<SocialSilkModule | undefined> {
    if (this.module) return this.module;
    this.probed ??= this.load().catch(() => undefined);
    this.module = await this.probed;
    return this.module;
  }
}

const AMR_HEADER = '#!AMR';

/** QQ voice payloads occasionally carry an AMR banner ahead of the SILK frames. */
export const stripAmrHeader = (data: Uint8Array): Uint8Array => {
  if (data.byteLength <= AMR_HEADER.length) return data;
  for (let index = 0; index < AMR_HEADER.length; index += 1) {
    if (data[index] !== AMR_HEADER.charCodeAt(index)) return data;
  }
  const newline = data.indexOf(0x0a, AMR_HEADER.length);
  return newline >= 0 ? data.subarray(newline + 1) : data;
};
