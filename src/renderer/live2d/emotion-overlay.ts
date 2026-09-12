import {
  EMOTION_CHANNELS,
  parseEmotionChannels,
  type EmotionChannels,
} from '../../core/character/emotion-channels';

export interface NativeEmotionCore {
  getParameterCount(): number;
  getParameterId(index: number): unknown;
  getParameterMinimumValue(index: number): number;
  getParameterMaximumValue(index: number): number;
  getParameterDefaultValue(index: number): number;
  getParameterValueByIndex(index: number): number;
  setParameterValueById(id: unknown, value: number): void;
}

const EMPTY = parseEmotionChannels({});
const FADE_MS = 320;
// Cubism parameter-space artistic presets; these are not VTS input parameter names.
const PRESETS = {
  joy: { mouth: 0.7, brow: 0.3, open: 0.1, eye: -0.08 },
  sadness: { mouth: -0.6, brow: -0.6, open: 0, eye: -0.25 },
  anger: { mouth: -0.5, brow: -0.8, open: 0.05, eye: -0.15 },
  fear: { mouth: -0.35, brow: 0.55, open: 0.2, eye: 0.15 },
  disgust: { mouth: -0.65, brow: -0.35, open: 0, eye: -0.35 },
  surprise: { mouth: 0, brow: 0.85, open: 0.6, eye: 0.25 },
  guilt: { mouth: -0.2, brow: -0.3, open: 0, eye: -0.2 },
} as const;
// Mouth opening stays entirely with audio/motion, including the engine's own motion audio.
const PARAMS = {
  ParamMouthForm: 'mouth',
  ParamBrowLY: 'brow',
  ParamBrowRY: 'brow',
  ParamEyeLOpen: 'eye',
  ParamEyeROpen: 'eye',
} as const;

/** Applied after runtime animation/blinking and before persistent parameters and lip sync. */
export class NativeEmotionOverlay {
  private from = EMPTY;
  private target = EMPTY;
  private changedAt = 0;
  public suspended = false;
  private readonly parameters: Array<{
    id: unknown;
    index: number;
    kind: (typeof PARAMS)[keyof typeof PARAMS];
    min: number;
    max: number;
    rest: number;
  }> = [];

  public constructor(
    private readonly core: NativeEmotionCore,
    ids: { getId(id: string): unknown },
    excluded: readonly string[] = [],
  ) {
    const count = core.getParameterCount();
    for (const [name, kind] of Object.entries(PARAMS)) {
      if (excluded.includes(name)) continue;
      const id = ids.getId(name);
      // Do not call getParameterIndex: Cubism can create a virtual slot for a missing ID.
      for (let index = 0; index < count; index += 1) {
        if (core.getParameterId(index) !== id) continue;
        const min = core.getParameterMinimumValue(index),
          max = core.getParameterMaximumValue(index),
          rest = core.getParameterDefaultValue(index);
        if ([min, max, rest].every(Number.isFinite) && max > min && rest >= min && rest <= max)
          this.parameters.push({ id, index, kind, min, max, rest });
        break;
      }
    }
  }

  public get supported(): boolean {
    return this.parameters.length > 0;
  }

  public clear(): void {
    this.from = EMPTY;
    this.target = EMPTY;
  }

  public set(channels: EmotionChannels | undefined, now = performance.now()): boolean {
    const target = channels ? parseEmotionChannels(channels) : EMPTY;
    if (EMOTION_CHANNELS.every((key) => target[key] === this.target[key])) return this.supported;
    this.from = this.sample(now);
    this.target = target;
    this.changedAt = now;
    return this.supported;
  }

  private sample(now: number): EmotionChannels {
    const ratio = Math.min(1, Math.max(0, (now - this.changedAt) / FADE_MS));
    return Object.fromEntries(
      EMOTION_CHANNELS.map((key) => [
        key,
        this.from[key] + (this.target[key] - this.from[key]) * ratio,
      ]),
    ) as unknown as EmotionChannels;
  }

  public apply(now = performance.now()): void {
    if (this.suspended) return;
    const channels = this.sample(now);
    const keys = Object.keys(PRESETS) as Array<keyof typeof PRESETS>;
    const total = keys.reduce((sum, key) => sum + channels[key], 0);
    if (total === 0) return;
    const soften = 1 - 0.08 * channels.trust - 0.08 * channels.love - 0.04 * channels.longing;
    const weight = Math.min(1, total) * soften;
    for (const parameter of this.parameters) {
      const base = this.core.getParameterValueByIndex(parameter.index);
      if (!Number.isFinite(base)) continue;
      const offset =
        keys.reduce((sum, key) => sum + PRESETS[key][parameter.kind] * channels[key], 0) / total;
      const target =
        parameter.kind === 'eye'
          ? base * (1 + offset * weight)
          : base +
            (parameter.rest +
              offset *
                (offset >= 0 ? parameter.max - parameter.rest : parameter.rest - parameter.min) -
              base) *
              weight;
      this.core.setParameterValueById(
        parameter.id,
        Math.min(parameter.max, Math.max(parameter.min, target)),
      );
    }
  }
}
