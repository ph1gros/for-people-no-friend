import { describe, expect, it } from 'vitest';

import {
  formatViewerExMappingDraft,
  parseViewerExMappingDraft,
} from '../src/renderer/viewerex/viewerex-mapping-draft';

describe('ViewerEX mapping draft', () => {
  it('parses bounded emotion motion alternatives and rejects executable paths and duplicates', () => {
    const draft = {
      stateMotions: '',
      emotionExpressions: '',
      actionMotions: '',
      emotionMotions: 'happy=tap:smile | tap:nod',
    };
    expect(parseViewerExMappingDraft(draft).emotionMotions).toEqual({
      happy: ['tap:smile', 'tap:nod'],
    });
    for (const emotionMotions of [
      'happy=tap | tap',
      'happy=C:\\evil.exe',
      'unknown=tap',
      'happy=' + Array.from({ length: 9 }, (_, i) => `tap:m${i}`).join('|'),
    ])
      expect(() => parseViewerExMappingDraft({ ...draft, emotionMotions })).toThrow();
  });
  it('parses state, emotion, and semantic action mappings', () => {
    expect(
      parseViewerExMappingDraft({
        stateMotions: 'thinking=idle:think\ntalking=talk',
        emotionExpressions: 'happy=0\nsad=2',
        actionMotions: 'wave=tap:wave_1',
      }),
    ).toEqual({
      stateMotions: { thinking: 'idle:think', talking: 'talk' },
      emotionExpressions: { happy: 0, sad: 2 },
      actionMotions: { wave: 'tap:wave_1' },
    });
  });

  it('rejects unknown keys, duplicates, paths, and invalid expression IDs', () => {
    expect(() =>
      parseViewerExMappingDraft({
        stateMotions: 'sleeping=idle',
        emotionExpressions: '',
        actionMotions: '',
      }),
    ).toThrow();
    expect(() =>
      parseViewerExMappingDraft({
        stateMotions: '',
        emotionExpressions: 'happy=0\nhappy=1',
        actionMotions: '',
      }),
    ).toThrow();
    expect(() =>
      parseViewerExMappingDraft({
        stateMotions: '',
        emotionExpressions: 'happy=not-a-number',
        actionMotions: 'wave=C:\\wave.motion3.json',
      }),
    ).toThrow();
  });

  it('formats mappings deterministically for the settings UI', () => {
    expect(formatViewerExMappingDraft({ happy: 1, neutral: 0 })).toBe('happy=1\nneutral=0');
  });
});
