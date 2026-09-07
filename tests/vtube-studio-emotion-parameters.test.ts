import { describe, expect, it } from 'vitest';

import {
  blendEmotionBias,
  emotionBias,
  EMOTION_PARAMETER_IDS,
} from '../src/main/vtube-studio/vtube-studio-emotion-parameters';
import { VTubeStudioIdleMotion } from '../src/main/vtube-studio/vtube-studio-idle-motion';

const valueOf = (frame: ReadonlyArray<{ id: string; value: number }>, id: string): number =>
  frame.find((parameter) => parameter.id === id)?.value ?? 0;

describe('generic emotion parameter channel', () => {
  it('writes only VTube Studio input parameters every model already binds', () => {
    // These are the ids both models on this machine list in their own ParameterSettings; a model
    // that binds them gets emotions with no per-model mapping at all.
    expect(EMOTION_PARAMETER_IDS).toEqual(['MouthSmile', 'Brows', 'MouthOpen', 'CheekPuff']);
  });

  it('leaves every parameter at rest for neutral', () => {
    const bias = emotionBias('neutral');
    for (const id of EMOTION_PARAMETER_IDS) expect(bias.absolute[id]).toBe(0);
    expect(bias.eyeOpenScaleLeft).toBe(1);
    expect(bias.eyeOpenScaleRight).toBe(1);
  });

  it('separates the emotions along the axes Cubism documents', () => {
    expect(emotionBias('happy').absolute.MouthSmile).toBeGreaterThan(0);
    expect(emotionBias('sad').absolute.MouthSmile).toBeLessThan(0);
    // Anger and sadness share a downturned mouth; the brows are what tells them apart.
    expect(emotionBias('angry').absolute.Brows).toBeLessThan(emotionBias('sad').absolute.Brows);
    expect(emotionBias('surprised').absolute.MouthOpen).toBeGreaterThan(0.5);
    expect(emotionBias('shy').absolute.CheekPuff).toBeGreaterThan(0.5);
  });

  it('closes one eye and not the other for playful, so it reads as a wink', () => {
    const bias = emotionBias('playful');
    expect(bias.eyeOpenScaleLeft).toBeLessThan(0.2);
    expect(bias.eyeOpenScaleRight).toBeGreaterThan(0.9);
  });

  it('crosses from one emotion to the next instead of snapping', () => {
    const half = blendEmotionBias('sad', 'happy', 0.5);
    expect(half.absolute.MouthSmile).toBeCloseTo(
      (emotionBias('sad').absolute.MouthSmile + emotionBias('happy').absolute.MouthSmile) / 2,
      5,
    );
    expect(blendEmotionBias('sad', 'happy', 0).absolute.MouthSmile).toBe(
      emotionBias('sad').absolute.MouthSmile,
    );
    expect(blendEmotionBias('sad', 'happy', 1).absolute.MouthSmile).toBe(
      emotionBias('happy').absolute.MouthSmile,
    );
  });

  it('clamps a ratio that ran past the end of the fade', () => {
    expect(blendEmotionBias('sad', 'happy', 4).absolute.Brows).toBe(
      emotionBias('happy').absolute.Brows,
    );
    expect(blendEmotionBias('sad', 'happy', -2).absolute.Brows).toBe(
      emotionBias('sad').absolute.Brows,
    );
  });
});

describe('idle motion carrying the emotion channel', () => {
  it('injects the emotion parameters alongside the idle pose', () => {
    const motion = new VTubeStudioIdleMotion();
    const resting = motion.frame(1_000_000, 'idle');
    for (const id of EMOTION_PARAMETER_IDS) expect(valueOf(resting, id)).toBe(0);

    expect(motion.setEmotion('happy', 1_000_000)).toBe(true);
    const smiling = motion.frame(1_000_400, 'idle');
    expect(valueOf(smiling, 'MouthSmile')).toBeGreaterThan(0.5);
    // The idle motion's own parameters must survive untouched.
    expect(smiling.some((parameter) => parameter.id === 'FaceAngleX')).toBe(true);
  });

  it('reports a repeated emotion as no change so callers can skip a redundant frame', () => {
    const motion = new VTubeStudioIdleMotion();
    expect(motion.setEmotion('angry', 1_000_000)).toBe(true);
    expect(motion.setEmotion('angry', 1_000_500)).toBe(false);
    expect(motion.currentEmotion()).toBe('angry');
  });

  it('scales the blink instead of replacing it, so a winking model still blinks', () => {
    const motion = new VTubeStudioIdleMotion();
    motion.setEmotion('playful', 1_000_000);
    const winking = motion.frame(1_000_400, 'idle');
    expect(valueOf(winking, 'EyeOpenLeft')).toBeLessThan(valueOf(winking, 'EyeOpenRight'));
    expect(valueOf(winking, 'EyeOpenRight')).toBeGreaterThan(0);
  });

  it('returns to a resting face when the emotion goes back to neutral', () => {
    const motion = new VTubeStudioIdleMotion();
    motion.setEmotion('surprised', 1_000_000);
    motion.setEmotion('neutral', 1_001_000);
    const settled = motion.frame(1_001_400, 'idle');
    for (const id of EMOTION_PARAMETER_IDS) expect(valueOf(settled, id)).toBeCloseTo(0, 5);
  });
});
