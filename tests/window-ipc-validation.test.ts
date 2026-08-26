import { describe, expect, it } from 'vitest';

import {
  parseSetChatPanelExpandedInput,
  MAX_WINDOW_SCALE,
  MIN_WINDOW_SCALE,
  parseSetWindowScaleInput,
} from '../src/shared/window-ipc';

describe('window scale IPC validation', () => {
  it('accepts only an explicit boolean chat panel state', () => {
    expect(parseSetChatPanelExpandedInput({ expanded: true })).toEqual({ expanded: true });
    expect(() => parseSetChatPanelExpandedInput({ expanded: 'yes' })).toThrow();
  });
  it('accepts values within the supported UI range', () => {
    expect(parseSetWindowScaleInput({ scale: MIN_WINDOW_SCALE })).toEqual({
      scale: MIN_WINDOW_SCALE,
    });
    expect(parseSetWindowScaleInput({ scale: MAX_WINDOW_SCALE })).toEqual({
      scale: MAX_WINDOW_SCALE,
    });
  });

  it('rejects non-finite and out-of-range values', () => {
    expect(() => parseSetWindowScaleInput({ scale: Number.NaN })).toThrow();
    expect(() => parseSetWindowScaleInput({ scale: MIN_WINDOW_SCALE - 0.01 })).toThrow();
    expect(() => parseSetWindowScaleInput({ scale: MAX_WINDOW_SCALE + 0.01 })).toThrow();
  });
});
