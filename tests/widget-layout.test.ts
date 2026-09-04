import { describe, expect, it } from 'vitest';

import { calculateDesktopWidgetReserve } from '../src/renderer/widgets/widget-layout';

describe('desktop widget responsive layout', () => {
  it('reserves the measured widget stack instead of a widget-type constant', () => {
    expect(calculateDesktopWidgetReserve(57.2, 520)).toBe(58);
    expect(calculateDesktopWidgetReserve(73.6, 520)).toBe(74);
    expect(calculateDesktopWidgetReserve(119.1, 520)).toBe(120);
  });

  it('keeps a bounded character stage in short windows', () => {
    expect(calculateDesktopWidgetReserve(180, 300)).toBe(135);
  });

  it('ignores missing or invalid measurements', () => {
    expect(calculateDesktopWidgetReserve(0, 520)).toBe(0);
    expect(calculateDesktopWidgetReserve(Number.NaN, 520)).toBe(0);
    expect(calculateDesktopWidgetReserve(80, 0)).toBe(0);
  });
});
