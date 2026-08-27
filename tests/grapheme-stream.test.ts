import { describe, expect, it } from 'vitest';

import { GraphemeStreamBuffer } from '../src/core/conversation/grapheme-stream';

describe('grapheme stream buffer', () => {
  it('does not emit half of an emoji or combining sequence', () => {
    const buffer = new GraphemeStreamBuffer();
    expect(buffer.push('你\ud83d')).toBe('你');
    expect(buffer.push('\ude00e')).toBe('😀');
    expect(buffer.push('\u0301好')).toBe('é');
    expect(buffer.finish()).toBe('好');
  });
});
