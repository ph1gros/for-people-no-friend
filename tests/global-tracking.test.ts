import { describe, expect, it } from 'vitest';

import { normalizeCursorToWorkArea } from '../src/main/ipc/global-tracking';

describe('global cursor tracking', () => {
  const workArea = { x: 100, y: 50, width: 1_600, height: 900 };

  it('maps display edges and center to the complete tracking range', () => {
    expect(normalizeCursorToWorkArea({ x: 100, y: 50 }, workArea)).toEqual({ x: -1, y: 1 });
    expect(normalizeCursorToWorkArea({ x: 900, y: 500 }, workArea)).toEqual({ x: 0, y: 0 });
    expect(normalizeCursorToWorkArea({ x: 1_700, y: 950 }, workArea)).toEqual({ x: 1, y: -1 });
  });

  it('clamps a cursor located on another display', () => {
    expect(normalizeCursorToWorkArea({ x: -2_000, y: 2_000 }, workArea)).toEqual({
      x: -1,
      y: -1,
    });
  });
});
