import type {
  VTubeStudioExpressionSummary,
  VTubeStudioParameterSummary,
} from '../../shared/vtube-studio-ipc';

/**
 * Read what an expression actually *does* to the model, instead of what it is called.
 *
 * Expression and file names are the weakest possible signal: a model may name its expressions
 * `Param101.exp3.json`, `New Expression 2`, or `嬉しい`, and no keyword table survives all three.
 * The parameters an expression writes are a different matter — Live2D Cubism publishes a standard
 * parameter list whose IDs and directions are fixed by the editor, and virtually every commercial
 * model follows it. `ParamMouthForm` is positive for a smiling mouth and negative for an angry one
 * on any model that uses the standard ID at all. That makes the parameter payload the one part of
 * an expression that means the same thing across models, languages and naming habits.
 *
 * https://docs.live2d.com/en/cubism-editor-manual/standard-parameter-list/
 */

/** Cubism standard ranges, used when the model did not report a parameter of its own. */
const STANDARD_PARAMETER_SPECS: Readonly<
  Record<string, { min: number; max: number; def: number }>
> = Object.freeze({
  PARAMANGLEX: { min: -30, max: 30, def: 0 },
  PARAMANGLEY: { min: -30, max: 30, def: 0 },
  PARAMANGLEZ: { min: -30, max: 30, def: 0 },
  PARAMEYELOPEN: { min: 0, max: 1, def: 1 },
  PARAMEYEROPEN: { min: 0, max: 1, def: 1 },
  PARAMEYELSMILE: { min: 0, max: 1, def: 0 },
  PARAMEYERSMILE: { min: 0, max: 1, def: 0 },
  PARAMEYEBALLX: { min: -1, max: 1, def: 0 },
  PARAMEYEBALLY: { min: -1, max: 1, def: 0 },
  PARAMBROWLY: { min: -1, max: 1, def: 0 },
  PARAMBROWRY: { min: -1, max: 1, def: 0 },
  PARAMBROWLX: { min: -1, max: 1, def: 0 },
  PARAMBROWRX: { min: -1, max: 1, def: 0 },
  PARAMBROWLANGLE: { min: -1, max: 1, def: 0 },
  PARAMBROWRANGLE: { min: -1, max: 1, def: 0 },
  PARAMBROWLFORM: { min: -1, max: 1, def: 0 },
  PARAMBROWRFORM: { min: -1, max: 1, def: 0 },
  PARAMMOUTHFORM: { min: -1, max: 1, def: 0 },
  PARAMMOUTHOPENY: { min: 0, max: 1, def: 0 },
  PARAMCHEEK: { min: 0, max: 1, def: 0 },
});

/**
 * Cubism 2.1 wrote the same IDs as `PARAM_EYE_L_OPEN`; stripping separators makes both spellings
 * land on one key, which is why the table above is keyed on the stripped form.
 */
const parameterKey = (name: string): string =>
  name
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');

/**
 * How far a written value sits from the parameter's resting value, as a fraction of the room it
 * has in that direction. +1 means "pushed all the way up", -1 "all the way down", 0 "unchanged".
 * Measuring against the parameter's own range is what lets one rule cover a model whose
 * `ParamEyeLOpen` tops out at 1 and a model that widened it to 2 for a surprised face.
 */
const normalizedOffset = (
  value: number,
  spec: { min: number; max: number; def: number },
): number => {
  if (!Number.isFinite(value)) return 0;
  if (value >= spec.def) {
    const room = spec.max - spec.def;
    return room > 0 ? Math.min(1, (value - spec.def) / room) : 0;
  }
  const room = spec.def - spec.min;
  return room > 0 ? Math.max(-1, (value - spec.def) / room) : 0;
};

export interface ExpressionSignals {
  /** −1 angry/frowning mouth … +1 smiling mouth. */
  mouthForm: number;
  /** 0 closed … +1 wide open. */
  mouthOpen: number;
  /** Averaged over both eyes; negative means narrowed, positive means widened past resting. */
  eyeOpen: number;
  eyeOpenLeft: number;
  eyeOpenRight: number;
  /** 0 … +1 crescent "smiling" eyes. */
  eyeSmile: number;
  eyeSmileLeft: number;
  eyeSmileRight: number;
  /** −1 lowered brows … +1 raised brows. */
  browY: number;
  /** Negative is the Cubism-documented direction for anger. */
  browForm: number;
  browAngle: number;
  /** 0 … +1 blush. */
  cheek: number;
  /** How many standard parameters this expression touched at all. */
  recognizedParameters: number;
}

const EMPTY_SIGNALS: ExpressionSignals = Object.freeze({
  mouthForm: 0,
  mouthOpen: 0,
  eyeOpen: 0,
  eyeOpenLeft: 0,
  eyeOpenRight: 0,
  eyeSmile: 0,
  eyeSmileLeft: 0,
  eyeSmileRight: 0,
  browY: 0,
  browForm: 0,
  browAngle: 0,
  cheek: 0,
  recognizedParameters: 0,
});

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

export const readExpressionSignals = (
  expression: VTubeStudioExpressionSummary,
  modelParameters: readonly VTubeStudioParameterSummary[] = [],
): ExpressionSignals => {
  const modelSpecs = new Map<string, { min: number; max: number; def: number }>();
  for (const parameter of modelParameters) {
    // A model that reports a degenerate range tells us nothing; fall back to the standard one.
    if (!(parameter.maximum > parameter.minimum)) continue;
    modelSpecs.set(parameterKey(parameter.name), {
      min: parameter.minimum,
      max: parameter.maximum,
      def: parameter.defaultValue,
    });
  }

  const offsets = new Map<string, number>();
  for (const { name, value } of expression.parameters) {
    const key = parameterKey(name);
    const spec = modelSpecs.get(key) ?? STANDARD_PARAMETER_SPECS[key];
    if (!spec) continue;
    offsets.set(key, normalizedOffset(value, spec));
  }
  if (offsets.size === 0) return EMPTY_SIGNALS;

  const at = (key: string): number => offsets.get(key) ?? 0;
  const pair = (left: string, right: string): number => {
    const present = [left, right].filter((key) => offsets.has(key)).map(at);
    return mean(present);
  };

  return {
    mouthForm: at('PARAMMOUTHFORM'),
    mouthOpen: at('PARAMMOUTHOPENY'),
    eyeOpen: pair('PARAMEYELOPEN', 'PARAMEYEROPEN'),
    eyeOpenLeft: at('PARAMEYELOPEN'),
    eyeOpenRight: at('PARAMEYEROPEN'),
    eyeSmile: pair('PARAMEYELSMILE', 'PARAMEYERSMILE'),
    eyeSmileLeft: at('PARAMEYELSMILE'),
    eyeSmileRight: at('PARAMEYERSMILE'),
    browY: pair('PARAMBROWLY', 'PARAMBROWRY'),
    browForm: pair('PARAMBROWLFORM', 'PARAMBROWRFORM'),
    browAngle: pair('PARAMBROWLANGLE', 'PARAMBROWRANGLE'),
    cheek: at('PARAMCHEEK'),
    recognizedParameters: offsets.size,
  };
};

/** Only counts a parameter as "pushed" once it is clearly off its resting value. */
const ON = 0.2;
const STRONG = 0.3;

/**
 * Scores are deliberately on the same scale as the name-based scorer so both tiers can share one
 * "clear winner" gate. A rule contributes only when its evidence is unambiguous; nothing here
 * guesses from a single weak signal.
 */
export const scoreSignalsForEmotion = (signals: ExpressionSignals): Record<string, number> => {
  const { mouthForm, mouthOpen, eyeOpen, eyeSmile, browY, browForm, browAngle, cheek } = signals;
  const winkGap = Math.abs(signals.eyeOpenLeft - signals.eyeOpenRight);
  const smileGap = Math.abs(signals.eyeSmileLeft - signals.eyeSmileRight);
  // Lowered brows read as sad on their own, but as anger the moment the brow *shape* turns in.
  const angryBrow = browForm <= -ON || browAngle <= -ON;

  return {
    happy:
      (mouthForm >= ON ? 3 : 0) + (eyeSmile >= ON ? 3 : 0) + (browY >= 0.15 && !angryBrow ? 1 : 0),
    sad:
      (mouthForm <= -ON ? 2 : 0) +
      (browY <= -0.15 ? 2 : 0) +
      (mouthForm <= -ON && browY <= -0.15 && !angryBrow ? 2 : 0),
    angry: (angryBrow ? 3 : 0) + (mouthForm <= -ON ? 1 : 0) + (browY <= -0.15 && angryBrow ? 1 : 0),
    surprised:
      (mouthOpen >= STRONG ? 2 : 0) +
      (eyeOpen >= 0.15 ? 2 : 0) +
      (browY >= STRONG && !angryBrow ? 1 : 0),
    shy: cheek >= STRONG ? 4 : 0,
    playful: (winkGap >= 0.4 ? 3 : 0) + (smileGap >= 0.4 ? 2 : 0),
    neutral: 0,
  };
};
