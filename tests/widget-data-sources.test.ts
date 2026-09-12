import { afterEach, describe, expect, it, vi } from 'vitest';
import { WidgetDataSources } from '../src/main/widgets/widget-data-sources';
import {
  formatWidgetValue,
  renderWidgetRow,
  renderWidgetSnapshot,
} from '../src/renderer/widgets/widget-row-renderer';
import { fakePanelDocument, PanelElement } from './helpers/panel-dom';
import { manifest } from './fixtures/widget-clock';

afterEach(() => vi.unstubAllGlobals());

describe('widget data permission boundary', () => {
  it('samples CPU deltas at most once per second and reads nothing when permission is denied', () => {
    let now = 0;
    const cpu = vi
      .fn()
      .mockReturnValueOnce({ idle: 40, total: 100 })
      .mockReturnValue({ idle: 60, total: 200 });
    const source = new WidgetDataSources(
      () => now,
      cpu,
      () => ({ total: 1000, free: 250 }),
    );
    expect(() => source.read('system.cpu', [])).toThrow();
    expect(cpu).not.toHaveBeenCalled();
    expect(source.read('system.cpu', ['system-load'])).toBeNull();
    expect(source.read('system.memory', ['system-load'])).toBe(0.75);
    now = 999;
    source.read('system.cpu', ['system-load']);
    expect(cpu).toHaveBeenCalledTimes(1);
    now = 1000;
    expect(source.read('system.cpu', ['system-load'])).toBe(0.8);
  });
  it('renders all row kinds as text and bounded progress, updates time and hides disabled widgets', () => {
    fakePanelDocument();
    const snapshot = {
      manifest,
      enabled: true,
      available: true,
      values: {
        'clock.time': new Date(2026, 8, 8, 0, 0).getTime(),
        'media.title': '<script>bad</script>',
        'system.cpu': 1.5,
        'input.keys': ['W', 'A'],
      },
    };
    const textRow = renderWidgetRow(
      { kind: 'label', source: 'media.title', format: 'raw' },
      snapshot,
      document,
    );
    expect(textRow.textContent).toBe('<script>bad</script>');
    const bar = renderWidgetRow(
      { kind: 'bar', source: 'system.cpu', min: 0, max: 1 },
      snapshot,
      document,
    ) as unknown as PanelElement;
    expect(bar.children[0]?.value).toBe(1);
    expect(
      renderWidgetRow({ kind: 'icons', source: 'input.keys' }, snapshot, document).textContent,
    ).toBe('W A');
    const container = Object.assign(new PanelElement('section'), { ownerDocument: document });
    renderWidgetSnapshot(container as unknown as HTMLElement, snapshot);
    expect(container.children[0]?.textContent).toBe('00:00');
    snapshot.values['clock.time'] += 60_000;
    renderWidgetSnapshot(container as unknown as HTMLElement, snapshot);
    expect(container.children[0]?.textContent).toBe('00:01');
    renderWidgetSnapshot(container as unknown as HTMLElement, { ...snapshot, enabled: false });
    expect(container.hidden).toBe(true);
  });
  it('checks granted permissions at every read', () => {
    const sources = new WidgetDataSources();
    expect(() => sources.read('clock.time', [])).toThrow();
    expect(typeof sources.read('clock.time', ['clock'])).toBe('number');
    expect(() => sources.read('system.cpu', ['clock'])).toThrow();
    expect(() => sources.read('constructor' as 'clock.time', ['clock'])).toThrow();
  });
  it('clamps numeric output and handles invalid or missing data', () => {
    expect(formatWidgetValue(1.5, 'percent')).toBe('100%');
    expect(formatWidgetValue(-0.2, 'percent')).toBe('0%');
    expect(formatWidgetValue(0, 'bytes')).toBe('0 B');
    expect(formatWidgetValue(2 ** 53, 'bytes')).toBe('—');
    expect(formatWidgetValue(NaN, 'percent')).toBe('—');
    expect(formatWidgetValue(null, 'raw')).toBe('—');
    expect(formatWidgetValue('<script>', 'raw')).toBe('<script>');
    const midnight = new Date(2026, 8, 8, 0, 0, 1).getTime();
    expect(formatWidgetValue(midnight, 'HH:mm')).toBe('00:00');
    expect(formatWidgetValue(midnight, 'HH:mm:ss')).toBe('00:00:01');
    expect(formatWidgetValue(midnight, 'M月d日 EEE')).toBe('9月8日 周二');
  });
});
