import type { CharacterEmotion } from '../../core/character/character-reply';

/**
 * Express an emotion without any per-model mapping at all.
 *
 * Expression files are the obvious channel, but plenty of models have none worth mapping: ATRI
 * ships sixteen "expressions" that are costumes, props and a blush, and nothing else. Those
 * models still emote, because VTube Studio drives their face from a fixed set of *input*
 * parameters that the model binds in its own ParameterSettings — `MouthSmile`, `Brows`,
 * `MouthOpen`, `EyeOpenLeft` / `EyeOpenRight`. Both models on this machine bind exactly those,
 * which is what makes this channel the one that generalises: it asks the model for a smile in
 * VTube Studio's vocabulary instead of asking it for a file it may not have.
 *
 * Values are the same ones the idle motion already injects, so this rides the existing
 * `InjectParameterDataRequest` loop rather than adding a second one.
 */

export interface EmotionParameterBias {
  /** Absolute values for parameters the idle motion does not otherwise write. */
  readonly absolute: Readonly<Record<string, number>>;
  /** Multipliers applied to the idle motion's own eye-open values, for winks and wide eyes. */
  readonly eyeOpenScaleLeft: number;
  readonly eyeOpenScaleRight: number;
}

const NEUTRAL: EmotionParameterBias = Object.freeze({
  absolute: Object.freeze({ MouthSmile: 0, Brows: 0, MouthOpen: 0, CheekPuff: 0 }),
  eyeOpenScaleLeft: 1,
  eyeOpenScaleRight: 1,
});

const BIAS: Readonly<Record<CharacterEmotion, EmotionParameterBias>> = Object.freeze({
  neutral: NEUTRAL,
  happy: {
    absolute: { MouthSmile: 0.7, Brows: 0.3, MouthOpen: 0.1, CheekPuff: 0 },
    eyeOpenScaleLeft: 0.92,
    eyeOpenScaleRight: 0.92,
  },
  sad: {
    absolute: { MouthSmile: -0.6, Brows: -0.6, MouthOpen: 0, CheekPuff: 0 },
    eyeOpenScaleLeft: 0.75,
    eyeOpenScaleRight: 0.75,
  },
  angry: {
    absolute: { MouthSmile: -0.5, Brows: -1, MouthOpen: 0.05, CheekPuff: 0 },
    eyeOpenScaleLeft: 0.85,
    eyeOpenScaleRight: 0.85,
  },
  surprised: {
    absolute: { MouthSmile: 0, Brows: 0.85, MouthOpen: 0.6, CheekPuff: 0 },
    eyeOpenScaleLeft: 1.25,
    eyeOpenScaleRight: 1.25,
  },
  shy: {
    absolute: { MouthSmile: 0.25, Brows: -0.15, MouthOpen: 0, CheekPuff: 0.7 },
    eyeOpenScaleLeft: 0.7,
    eyeOpenScaleRight: 0.7,
  },
  playful: {
    // One eye closed is the whole gesture; keeping the other wide is what reads as a wink
    // rather than a blink.
    absolute: { MouthSmile: 0.5, Brows: 0.2, MouthOpen: 0, CheekPuff: 0 },
    eyeOpenScaleLeft: 0.05,
    eyeOpenScaleRight: 1.05,
  },
});

/** Parameter ids this channel writes, so callers can tell them apart from the idle motion's. */
export const EMOTION_PARAMETER_IDS: readonly string[] = Object.freeze([
  'MouthSmile',
  'Brows',
  'MouthOpen',
  'CheekPuff',
]);

export const EMOTION_FADE_MS = 320;

/** Snaps at both ends so a finished fade lands exactly on the target, not a float near it. */
const lerp = (from: number, to: number, ratio: number): number =>
  ratio <= 0 ? from : ratio >= 1 ? to : from + (to - from) * ratio;

/**
 * Blends between two emotions so a change reads as a face moving rather than snapping. `ratio`
 * is 0 at the start of the fade and 1 once it has finished.
 */
export const blendEmotionBias = (
  from: CharacterEmotion,
  to: CharacterEmotion,
  ratio: number,
): EmotionParameterBias => {
  const start = BIAS[from] ?? NEUTRAL;
  const end = BIAS[to] ?? NEUTRAL;
  const clamped = Math.min(1, Math.max(0, ratio));
  const absolute: Record<string, number> = {};
  for (const id of EMOTION_PARAMETER_IDS) {
    absolute[id] = lerp(start.absolute[id] ?? 0, end.absolute[id] ?? 0, clamped);
  }
  return {
    absolute,
    eyeOpenScaleLeft: lerp(start.eyeOpenScaleLeft, end.eyeOpenScaleLeft, clamped),
    eyeOpenScaleRight: lerp(start.eyeOpenScaleRight, end.eyeOpenScaleRight, clamped),
  };
};

export const emotionBias = (emotion: CharacterEmotion): EmotionParameterBias =>
  BIAS[emotion] ?? NEUTRAL;
