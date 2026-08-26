import { describe, expect, it } from 'vitest';

import {
  boundsToState,
  createDefaultWindowState,
  keepWindowVisible,
  MAX_WINDOW_SCALE,
  parseWindowState,
  resizeStateAroundCenter,
  stateToBounds,
} from '../src/main/windows/window-state';

const primaryWorkArea = { x: 0, y: 0, width: 1920, height: 1040 };
const secondaryWorkArea = { x: 1920, y: 0, width: 1280, height: 984 };

describe('window state', () => {
  it('places a new deskpet near the bottom-right of the primary work area', () => {
    expect(createDefaultWindowState(primaryWorkArea)).toEqual({
      version: 1,
      x: 1536,
      y: 496,
      scale: 1,
    });
  });

  it('rejects malformed persisted state and clamps a valid scale', () => {
    expect(parseWindowState({ version: 1, x: '10', y: 20, scale: 1 })).toBeUndefined();
    expect(parseWindowState({ version: 1, x: 10, y: 20, scale: 99 })).toEqual({
      version: 1,
      x: 10,
      y: 20,
      scale: MAX_WINDOW_SCALE,
    });
  });

  it('keeps a saved window on the secondary display', () => {
    const restored = keepWindowVisible(
      { version: 1, x: 2400, y: 300, scale: 1.2 },
      [{ workArea: primaryWorkArea }, { workArea: secondaryWorkArea }],
      primaryWorkArea,
    );

    expect(restored).toEqual({ version: 1, x: 2400, y: 300, scale: 1.2 });
  });

  it('recovers an off-screen window onto the primary display', () => {
    const restored = keepWindowVisible(
      { version: 1, x: 5000, y: -2000, scale: 1 },
      [{ workArea: primaryWorkArea }],
      primaryWorkArea,
    );

    expect(restored).toEqual({ version: 1, x: 1560, y: 0, scale: 1 });
  });

  it('shrinks a window when the available work area cannot contain its saved size', () => {
    const smallWorkArea = { x: 0, y: 0, width: 300, height: 400 };
    const restored = keepWindowVisible(
      { version: 1, x: 0, y: 0, scale: 1.5 },
      [{ workArea: smallWorkArea }],
      smallWorkArea,
    );

    expect(stateToBounds(restored)).toEqual({ x: 0, y: 0, width: 277, height: 400 });
  });

  it('round-trips window bounds as position and scale', () => {
    expect(stateToBounds(boundsToState({ x: 120, y: 80, width: 432, height: 624 }))).toEqual({
      x: 120,
      y: 80,
      width: 432,
      height: 624,
    });
  });

  it('resizes around the current window center', () => {
    expect(resizeStateAroundCenter({ version: 1, x: 100, y: 100, scale: 1 }, 1.5)).toEqual({
      version: 1,
      x: 10,
      y: -30,
      scale: 1.5,
    });
  });

  it('keeps the Live2D stage height while adding a separate side chat panel', () => {
    expect(stateToBounds({ version: 1, x: 120, y: 80, scale: 1 }, true)).toEqual({
      x: 120,
      y: 80,
      width: 720,
      height: 520,
    });
    expect(boundsToState({ x: 120, y: 80, width: 720, height: 520 })).toEqual({
      version: 1,
      x: 120,
      y: 80,
      scale: 1,
    });
  });
});
