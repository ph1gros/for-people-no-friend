import { expect, it } from 'vitest';
import { NativeEmotionOverlay } from '../src/renderer/live2d/emotion-overlay';
import { parseEmotionChannels } from '../src/core/character/emotion-channels';

it('normalizes to the model range and keeps continuity when the target changes during a fade', () => {
  let value = 0;
  const core = {
    getParameterCount: () => 1,
    getParameterId: () => 'ParamMouthForm',
    getParameterMinimumValue: () => -0.5,
    getParameterMaximumValue: () => 0.5,
    getParameterDefaultValue: () => 0,
    getParameterValueByIndex: () => value,
    setParameterValueById: (_id: unknown, next: number) => {
      value = next;
    },
  };
  const overlay = new NativeEmotionOverlay(core, { getId: (id) => id });
  overlay.set(parseEmotionChannels({ joy: 1 }), 1000);
  overlay.apply(1160);
  expect(value).toBeCloseTo(0.175);
  const previous = value;
  overlay.set(parseEmotionChannels({ fear: 1 }), 1160);
  value = 0; // The runtime restores animation parameters before each overlay pass.
  overlay.apply(1160);
  expect(value).toBeCloseTo(previous);
  value = 0;
  overlay.apply(1480);
  expect(value).toBeCloseTo(-0.175);
  const unsupported = new NativeEmotionOverlay(
    { ...core, getParameterCount: () => 0 },
    { getId: (id) => id },
  );
  expect(unsupported.set(parseEmotionChannels({ joy: 1 }))).toBe(false);
});

it('blends supported facial parameters while preserving blinking, lipsync and persistent controls', () => {
  const values = new Map([
    ['ParamMouthForm', 0],
    ['ParamEyeLOpen', 0],
    ['ParamMouthOpenY', 0.8],
    ['ParamBrowLY', 0.4],
  ]);
  const ids = [...values.keys()];
  const core = {
    getParameterCount: () => ids.length,
    getParameterId: (i: number) => ids[i],
    getParameterMinimumValue: () => -1,
    getParameterMaximumValue: () => 1,
    getParameterDefaultValue: () => 0,
    getParameterValueByIndex: (i: number) => values.get(ids[i]!)!,
    setParameterValueById: (id: unknown, value: number) => {
      values.set(String(id), value);
    },
  };
  const overlay = new NativeEmotionOverlay(core, { getId: (id: string) => id }, [
    'ParamBrowLY',
    'ParamMouthOpenY',
  ]);
  overlay.set(parseEmotionChannels({ joy: 1 }), 1000);
  overlay.apply(1320);
  expect(values.get('ParamMouthForm')).toBeGreaterThan(0);
  expect(values.get('ParamEyeLOpen')).toBe(0);
  expect(values.get('ParamMouthOpenY')).toBe(0.8);
  expect(values.get('ParamBrowLY')).toBe(0.4);
  overlay.suspended = true;
  values.set('ParamMouthForm', -0.4);
  overlay.apply(1400);
  expect(values.get('ParamMouthForm')).toBe(-0.4);
  overlay.suspended = false;
  overlay.set(undefined, 1320);
  values.set('ParamMouthForm', -0.2);
  overlay.apply(1640);
  expect(values.get('ParamMouthForm')).toBe(-0.2);
});
