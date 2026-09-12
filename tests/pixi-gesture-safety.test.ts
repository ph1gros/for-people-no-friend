import { afterEach, expect, it, vi } from 'vitest';
vi.mock('pixi.js/unsafe-eval', () => ({}));
vi.mock('pixi.js', () => ({ Application: class {}, extensions: {}, Rectangle: class {} }));
import { PixiLive2DDriver } from '../src/renderer/live2d/pixi-driver';
import { NativeGestureOverlay } from '../src/renderer/live2d/gesture-overlay';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const fixture = () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  const values = [0];
  const overlay = new NativeGestureOverlay(
    {
      getParameterCount: () => 1,
      getParameterId: () => 'ParamAngleY',
      getParameterMinimumValue: () => -30,
      getParameterMaximumValue: () => 30,
      getParameterDefaultValue: () => 0,
      getParameterValueByIndex: () => values[0]!,
      setParameterValueById: (_id, value) => {
        values[0] = value;
      },
    },
    { getId: (id) => id },
  );
  const model = {
    motion: vi.fn(async () => false),
    automator: {},
    internalModel: { motionManager: { state: { currentPriority: 1 } } },
  };
  const emotionOverlay = { suspended: false };
  const driver = new PixiLive2DDriver(
    { destroy: vi.fn() } as never,
    model as never,
    { idle: 1, force: 3 } as never,
    vi.fn(),
    vi.fn(),
    emotionOverlay as never,
    overlay,
  );
  return { driver, overlay, model, emotionOverlay };
};

it('declines gestures while the engine has a higher priority motion', async () => {
  const { driver, model } = fixture();
  model.internalModel.motionManager.state.currentPriority = 2;
  await expect(driver.playGesture('nod')).resolves.toBe(false);
});

it('does not let a stale authored action finish release the newer action lock', async () => {
  const { driver, model, emotionOverlay } = fixture();
  const finishes: Array<() => void> = [];
  model.motion.mockImplementation((...args: unknown[]) => {
    finishes.push((args[3] as { onFinish: () => void }).onFinish);
    return Promise.resolve(true);
  });
  const first = driver.playAction({ group: 'First' });
  const second = driver.playAction({ group: 'Second' });
  finishes[0]!();
  await first;
  expect(emotionOverlay.suspended).toBe(true);
  const gesture = driver.playGesture('nod');
  // A false result settles immediately; a wrongly accepted gesture owns a timer.
  expect(vi.getTimerCount()).toBe(1);
  await expect(gesture).resolves.toBe(false);
  finishes[1]!();
  await second;
  expect(emotionOverlay.suspended).toBe(false);
  driver.destroy();
});

it.each(['talking', 'thinking'] as const)(
  'cancels a gesture and declines new ones while %s',
  async (state) => {
    const { driver } = fixture();
    const pending = driver.playGesture('nod');
    driver.setGestureState(state);
    await expect(pending).resolves.toBe(false);
    await expect(driver.playGesture('nod')).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('yields to speech, pressed pointer interaction and authored actions, then allows reuse', async () => {
  const { driver, overlay } = fixture();
  let pending = driver.playGesture('nod');
  driver.setLipSync(0.2);
  await expect(pending).resolves.toBe(false);
  await expect(driver.playGesture('nod')).resolves.toBe(false);
  driver.setLipSync(0);
  pending = driver.playGesture('nod');
  driver.setGestureInteraction(true);
  await expect(pending).resolves.toBe(false);
  await expect(driver.playGesture('nod')).resolves.toBe(false);
  driver.setGestureInteraction(false);
  pending = driver.playGesture('nod');
  const authored = driver.playAction({ group: 'UserConfirmed' });
  const blockedByAction = driver.playGesture('nod');
  await expect(pending).resolves.toBe(false);
  await expect(blockedByAction).resolves.toBe(false);
  await authored;
  pending = driver.playGesture('nod');
  overlay.apply(performance.now() + 600);
  await vi.advanceTimersByTimeAsync(1200);
  await expect(pending).resolves.toBe(true);
  pending = driver.playGesture('nod');
  driver.destroy();
  await expect(pending).resolves.toBe(false);
  await expect(driver.playGesture('nod')).resolves.toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
