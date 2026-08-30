import { describe, expect, it } from 'vitest';

import {
  parseCharacterDisplayMode,
  parseSetCharacterDisplayModeInput,
} from '../src/shared/character-display-ipc';

describe('character display IPC validation', () => {
  it('accepts only the fixed mutually exclusive display modes', () => {
    expect(parseCharacterDisplayMode('off')).toBe('off');
    expect(parseCharacterDisplayMode('live2d')).toBe('live2d');
    expect(parseCharacterDisplayMode('viewerex')).toBe('viewerex');
    expect(parseCharacterDisplayMode('vtube-studio')).toBe('vtube-studio');
    expect(parseSetCharacterDisplayModeInput({ mode: 'live2d' })).toEqual({ mode: 'live2d' });
  });

  it('rejects unknown values and malformed renderer input', () => {
    expect(() => parseCharacterDisplayMode('both')).toThrow();
    expect(() => parseSetCharacterDisplayModeInput({ mode: true })).toThrow();
    expect(() => parseSetCharacterDisplayModeInput(null)).toThrow();
  });
});
