import { afterEach, expect, it, vi } from 'vitest';
import { NativeGestureOverlay } from '../src/renderer/live2d/gesture-overlay';

afterEach(() => vi.useRealTimers());

const fixture = (excluded: string[] = []) => {
  const values = new Map([
    ['ParamAngleX', 0],
    ['ParamAngleY', 0],
    ['ParamMouthOpenY', 0.7],
  ]);
  const ids = [...values.keys()];
  const overlay = new NativeGestureOverlay(
    {
      getParameterCount: () => ids.length,
      getParameterId: (index) => ids[index],
      getParameterMinimumValue: () => -0.5,
      getParameterMaximumValue: () => 0.5,
      getParameterDefaultValue: () => 0,
      getParameterValueByIndex: (index) => values.get(ids[index]!)!,
      setParameterValueById: (id, value) => {
        values.set(String(id), value);
      },
    },
    { getId: (id) => id },
    excluded,
  );
  return { overlay, values };
};

it('nods within the actual head range and releases without touching the mouth', async () => {
  vi.useFakeTimers();
  const { overlay, values } = fixture();
  const pending = overlay.play('nod', 0);
  overlay.apply(600);
  expect(values.get('ParamAngleY')).toBeLessThan(0);
  expect(values.get('ParamAngleY')).toBeGreaterThanOrEqual(-0.5);
  expect(values.get('ParamAngleX')).toBe(0);
  expect(values.get('ParamMouthOpenY')).toBe(0.7);
  await vi.advanceTimersByTimeAsync(1200);
  await expect(pending).resolves.toBe(true);
  values.set('ParamAngleY', 0.2);
  overlay.apply(1400);
  expect(values.get('ParamAngleY')).toBe(0.2);
});

it('reserves fixed and lip-sync parameters', async () => {
  const { overlay } = fixture(['ParamAngleY', 'ParamAngleX']);
  expect(overlay.supportedActions).toEqual([]);
  await expect(overlay.play('nod')).resolves.toBe(false);
});

it('does not create a virtual head parameter in a model without one', async () => {
  const write = vi.fn();
  const overlay = new NativeGestureOverlay(
    {
      getParameterCount: () => 0,
      getParameterId: () => undefined,
      getParameterMinimumValue: () => -30,
      getParameterMaximumValue: () => 30,
      getParameterDefaultValue: () => 0,
      getParameterValueByIndex: () => 0,
      setParameterValueById: write,
    },
    { getId: (id) => id },
  );
  expect(overlay.supportedActions).toEqual([]);
  await expect(overlay.play('nod')).resolves.toBe(false);
  overlay.apply(600);
  expect(write).not.toHaveBeenCalled();
});

it('shakes both ways with a smooth envelope and clamps against the model bounds', async () => {
  vi.useFakeTimers();
  const { overlay, values } = fixture();
  const pending = overlay.play('shake', 0);
  values.set('ParamAngleX', 0.49);
  overlay.apply(300);
  expect(values.get('ParamAngleX')).toBe(0.5);
  values.set('ParamAngleX', -0.49);
  overlay.apply(900);
  expect(values.get('ParamAngleX')).toBe(-0.5);
  overlay.cancel();
  await expect(pending).resolves.toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  values.set('ParamAngleX', 0.1);
  overlay.apply(1000);
  expect(values.get('ParamAngleX')).toBe(0.1);
});

it('does not stack gestures or report success when no frame was rendered', async () => {
  vi.useFakeTimers();
  const { overlay } = fixture();
  const first = overlay.play('nod', 0);
  await expect(overlay.play('shake', 0)).resolves.toBe(false);
  await vi.advanceTimersByTimeAsync(1200);
  await expect(first).resolves.toBe(false);
});
