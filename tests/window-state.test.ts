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
      version: 5,
      x: 1590,
      y: 574,
      scale: 0.85,
    });
  });

  it('rejects malformed persisted state and clamps a valid scale', () => {
    expect(parseWindowState({ version: 1, x: '10', y: 20, scale: 1 })).toBeUndefined();
    expect(parseWindowState({ version: 1, x: 10, y: 20, scale: 99 })).toEqual({
      version: 5,
      x: 10,
      y: 20,
      scale: MAX_WINDOW_SCALE,
    });
  });

  it('keeps a saved window on the secondary display', () => {
    const restored = keepWindowVisible(
      { version: 5, x: 2400, y: 300, scale: 1.2 },
      [{ workArea: primaryWorkArea }, { workArea: secondaryWorkArea }],
      primaryWorkArea,
    );

    expect(restored).toEqual({ version: 5, x: 2400, y: 300, scale: 1.2 });
  });

  it('recovers an off-screen window onto the primary display', () => {
    const restored = keepWindowVisible(
      { version: 5, x: 5000, y: -2000, scale: 1 },
      [{ workArea: primaryWorkArea }],
      primaryWorkArea,
    );

    expect(restored).toEqual({ version: 5, x: 1560, y: 0, scale: 1 });
  });

  it('shrinks a window when the available work area cannot contain its saved size', () => {
    const smallWorkArea = { x: 0, y: 0, width: 300, height: 400 };
    const restored = keepWindowVisible(
      { version: 5, x: 0, y: 0, scale: 1.5 },
      [{ workArea: smallWorkArea }],
      smallWorkArea,
    );

    expect(stateToBounds(restored)).toEqual({ x: 0, y: 0, width: 277, height: 400 });
  });

  it('round-trips window bounds as position and scale', () => {
    expect(stateToBounds(boundsToState({ x: 120, y: 80, width: 324, height: 468 }))).toEqual({
      x: 120,
      y: 80,
      width: 324,
      height: 468,
    });
  });

  it('resizes around the current window center', () => {
    expect(resizeStateAroundCenter({ version: 5, x: 100, y: 100, scale: 1 }, 1.5)).toEqual({
      version: 5,
      x: 10,
      y: -30,
      scale: 1.5,
    });
  });

  it('keeps the Live2D stage height while adding a separate side chat panel', () => {
    expect(stateToBounds({ version: 5, x: 120, y: 80, scale: 0.85 }, true)).toEqual({
      x: 120,
      y: 80,
      width: 612,
      height: 442,
    });
    expect(boundsToState({ x: 120, y: 80, width: 612, height: 442 })).toEqual({
      version: 5,
      x: 120,
      y: 80,
      scale: 0.85,
    });
    expect(stateToBounds({ version: 5, x: 120, y: 80, scale: 0.85 }, true, true)).toEqual({
      x: 120,
      y: 80,
      width: 612,
      height: 442,
    });
  });

  it('migrates old default scales onto the new 85 percent baseline', () => {
    expect(parseWindowState({ version: 1, x: 10, y: 20, scale: 1 })).toEqual({
      version: 5,
      x: 10,
      y: 20,
      scale: 0.85,
    });
    expect(parseWindowState({ version: 2, x: 10, y: 20, scale: 1.2 })).toEqual({
      version: 5,
      x: 10,
      y: 20,
      scale: 1.2,
    });
    expect(parseWindowState({ version: 3, x: 10, y: 20, scale: 0.9 })).toEqual({
      version: 5,
      x: 10,
      y: 20,
      scale: 0.85,
    });
    expect(parseWindowState({ version: 4, x: 10, y: 20, scale: 0.8 })).toEqual({
      version: 5,
      x: 10,
      y: 20,
      scale: 0.85,
    });
  });
});
