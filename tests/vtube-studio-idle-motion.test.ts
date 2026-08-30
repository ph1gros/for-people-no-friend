import { describe, expect, it } from 'vitest';

import { VTubeStudioIdleMotion } from '../src/main/vtube-studio/vtube-studio-idle-motion';

describe('VTube Studio idle motion', () => {
  it('keeps movement subtle and closes both eyes together during a blink', () => {
    const motion = new VTubeStudioIdleMotion(0, () => 0);
    const idle = Object.fromEntries(
      motion.frame(1_000, 'idle').map(({ id, value }) => [id, value]),
    );
    const blink = Object.fromEntries(
      motion.frame(1_320, 'idle').map(({ id, value }) => [id, value]),
    );

    expect(Math.abs(idle.FaceAngleX)).toBeLessThanOrEqual(4.2);
    expect(Math.abs(idle.FaceAngleY)).toBeLessThanOrEqual(2.4);
    expect(Math.abs(idle.FaceAngleZ)).toBeLessThanOrEqual(3.2);
    expect(Math.abs(idle.EyeRightX)).toBeLessThanOrEqual(0.08);
    expect(Math.abs(idle.EyeRightY)).toBeLessThanOrEqual(0.04);
    expect(idle.EyeOpenLeft).toBe(0.8);
    expect(blink.EyeOpenLeft).toBe(0);
    expect(blink.EyeOpenRight).toBe(blink.EyeOpenLeft);
  });

  it('uses a slightly more active thinking profile without large movements', () => {
    const motion = new VTubeStudioIdleMotion(0, () => 1);
    const values = Object.fromEntries(
      motion.frame(2_000, 'thinking').map(({ id, value }) => [id, value]),
    );

    expect(Math.abs(values.FaceAngleX)).toBeLessThanOrEqual(5.2);
    expect(Math.abs(values.FaceAngleY)).toBeLessThanOrEqual(3.2);
    expect(Math.abs(values.FaceAngleZ)).toBeLessThanOrEqual(3.4);
  });

  it('moves toward randomized multi-axis poses instead of a fixed left-right loop', () => {
    const values = [0.5, 1, 0.2, 0.8, 0.1, 0.7, 0.5, 0.1, 0.9, 0.3, 0.8, 0.2];
    let index = 0;
    const motion = new VTubeStudioIdleMotion(0, () => values[index++ % values.length]);
    const first = Object.fromEntries(
      motion.frame(1_000, 'idle').map(({ id, value }) => [id, value]),
    );
    const later = Object.fromEntries(
      motion.frame(4_500, 'idle').map(({ id, value }) => [id, value]),
    );

    expect(first.FaceAngleY).not.toBe(0);
    expect(first.FaceAngleZ).not.toBe(0);
    expect(later.FaceAngleX).not.toBeCloseTo(-first.FaceAngleX);
    expect(later.FaceAngleY).not.toBeCloseTo(first.FaceAngleY);
  });

  it('blends a bounded mouse target into the eyes and head', () => {
    const motion = new VTubeStudioIdleMotion(0, () => 0.5);
    const tracked = Object.fromEntries(
      motion.frame(500, 'idle', { x: 0.5, y: -0.5, weight: 1 }).map(({ id, value }) => [id, value]),
    );

    expect(tracked.EyeRightX).toBeCloseTo(-0.25);
    expect(tracked.EyeRightY).toBeCloseTo(-0.17);
    expect(tracked.FaceAngleX).toBeGreaterThan(0);
    expect(tracked.FaceAngleY).toBeLessThan(0);
  });

  it('keeps upward eye tracking unchanged while strengthening horizontal and downward tracking', () => {
    const motion = new VTubeStudioIdleMotion(0, () => 0.5);
    const upward = Object.fromEntries(
      motion.frame(500, 'idle', { x: -0.5, y: 0.5, weight: 1 }).map(({ id, value }) => [id, value]),
    );

    expect(upward.EyeRightX).toBeCloseTo(0.25);
    expect(upward.EyeRightY).toBeCloseTo(0.14);
  });

  it('synthesizes one gentle nod and returns to idle', () => {
    const baseline = new VTubeStudioIdleMotion(0, () => 0.5);
    const motion = new VTubeStudioIdleMotion(0, () => 0.5);
    expect(motion.triggerAction('nod', 1_000)).toBe(true);
    expect(motion.triggerAction('unknown', 1_000)).toBe(false);

    const at = (source: VTubeStudioIdleMotion, now: number): number =>
      Object.fromEntries(source.frame(now, 'idle').map(({ id, value }) => [id, value])).FaceAngleY;
    expect(at(motion, 1_300) - at(baseline, 1_300)).toBeCloseTo(-2);
    expect(at(motion, 1_600) - at(baseline, 1_600)).toBeCloseTo(-4);
    expect(at(motion, 1_900) - at(baseline, 1_900)).toBeCloseTo(-2);
    expect(at(motion, 2_200) - at(baseline, 2_200)).toBeCloseTo(0);
  });

  it('occasionally nods while idle but yields to mouse tracking and conversation', () => {
    const idle = new VTubeStudioIdleMotion(0, () => 0);
    const tracked = new VTubeStudioIdleMotion(0, () => 0);
    const thinking = new VTubeStudioIdleMotion(0, () => 0);
    const faceY = (
      source: VTubeStudioIdleMotion,
      now: number,
      state: 'idle' | 'thinking',
      pointer?: { x: number; y: number; weight: number },
    ): number =>
      Object.fromEntries(source.frame(now, state, pointer).map(({ id, value }) => [id, value]))
        .FaceAngleY;

    faceY(idle, 18_000, 'idle');
    faceY(tracked, 18_000, 'idle', { x: 0.5, y: 0, weight: 1 });
    faceY(thinking, 18_000, 'thinking');

    const idleAccent = faceY(idle, 18_600, 'idle');
    const trackedAccent = faceY(tracked, 18_600, 'idle');
    const thinkingAccent = faceY(thinking, 18_600, 'idle');
    expect(idleAccent).toBeLessThan(trackedAccent - 3);
    expect(idleAccent).toBeLessThan(thinkingAccent - 3);
  });

  it('slowly closes, peeks below half-open near the pointer, and slowly wakes for conversation', () => {
    const motion = new VTubeStudioIdleMotion(0, () => 0.5);
    expect(motion.triggerAction('drowsy', 1_000)).toBe(true);
    const eyesAt = (
      now: number,
      state: 'idle' | 'thinking',
      pointerWeight = 0,
      pointerProximity = 0,
    ): number =>
      Object.fromEntries(
        motion
          .frame(now, state, {
            x: 0,
            y: 0,
            weight: pointerWeight,
            proximity: pointerProximity,
          })
          .map(({ id, value }) => [id, value]),
      ).EyeOpenLeft;

    expect(eyesAt(1_050, 'idle')).toBeGreaterThan(0.7);
    expect(eyesAt(3_000, 'idle')).toBe(0);
    expect(eyesAt(3_700, 'idle', 1, 1)).toBeCloseTo(0.28);
    expect(eyesAt(3_700, 'thinking')).toBeCloseTo(0.28);
    expect(eyesAt(4_700, 'thinking')).toBeGreaterThan(0.6);
    expect(eyesAt(6_000, 'thinking')).toBeCloseTo(0.8);
  });

  it('waits between sleeping nods instead of repeating on a fixed short loop', () => {
    const baseline = new VTubeStudioIdleMotion(0, () => 0.5);
    const sleeping = new VTubeStudioIdleMotion(0, () => 0.5);
    expect(sleeping.triggerAction('drowsy', 1_000)).toBe(true);
    const faceY = (source: VTubeStudioIdleMotion, now: number): number =>
      Object.fromEntries(source.frame(now, 'idle').map(({ id, value }) => [id, value])).FaceAngleY;

    expect(faceY(sleeping, 9_999) - faceY(baseline, 9_999)).toBeCloseTo(0);
    faceY(sleeping, 10_000);
    expect(faceY(sleeping, 11_300) - faceY(baseline, 11_300)).toBeCloseTo(-5.75);
    expect(faceY(sleeping, 20_000) - faceY(baseline, 20_000)).toBeCloseTo(0);
  });

  it('randomizes both sleeping nod timing and depth within gentle bounds', () => {
    const shallowBaseline = new VTubeStudioIdleMotion(0, () => 0);
    const shallow = new VTubeStudioIdleMotion(0, () => 0);
    const deepBaseline = new VTubeStudioIdleMotion(0, () => 1);
    const deep = new VTubeStudioIdleMotion(0, () => 1);
    shallow.triggerAction('drowsy', 1_000);
    deep.triggerAction('drowsy', 1_000);
    const faceY = (source: VTubeStudioIdleMotion, now: number): number =>
      Object.fromEntries(source.frame(now, 'idle').map(({ id, value }) => [id, value])).FaceAngleY;

    faceY(shallow, 7_000);
    expect(faceY(shallow, 8_000) - faceY(shallowBaseline, 8_000)).toBeCloseTo(-4);
    expect(faceY(deep, 8_000) - faceY(deepBaseline, 8_000)).toBeCloseTo(0);
    faceY(deep, 13_000);
    expect(faceY(deep, 14_600) - faceY(deepBaseline, 14_600)).toBeCloseTo(-7.5);
  });
});
