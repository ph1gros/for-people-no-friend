import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  Live2DControlMap,
  Live2DDriver,
  MotionReference,
  TrackingPoint,
} from '../src/renderer/live2d/contracts';
import { Live2DPerformanceController } from '../src/renderer/live2d/performance-controller';

const controls: Live2DControlMap = {
  states: {
    idle: { group: 'Idle', index: 0 },
    thinking: { group: 'Thinking', index: 0 },
  },
  actions: {
    wave: { group: 'Wave', index: 0 },
    nod: { group: 'Nod', index: 0 },
  },
  emotions: { neutral: 'neutral', happy: 'smile' },
};

class FakeDriver implements Live2DDriver {
  public readonly calls: string[] = [];
  public readonly tracking: TrackingPoint[] = [];
  public readonly actionResolvers: Array<(played: boolean) => void> = [];
  public rejectedExpressions = new Set<string>();

  public playState(motion: MotionReference): Promise<boolean> {
    this.calls.push(`state:${motion.group}`);
    return Promise.resolve(true);
  }

  public playAction(motion: MotionReference): Promise<boolean> {
    this.calls.push(`action:${motion.group}`);
    return new Promise((resolve) => this.actionResolvers.push(resolve));
  }

  public setExpression(expressionId?: string): Promise<boolean> {
    this.calls.push(`emotion:${expressionId ?? 'default'}`);
    return Promise.resolve(!expressionId || !this.rejectedExpressions.has(expressionId));
  }

  public setTracking(point: TrackingPoint): void {
    this.tracking.push(point);
  }

  public resetTracking(): void {
    this.calls.push('tracking:reset');
  }

  public destroy(): void {
    this.calls.push('destroy');
  }
}

const nextTurn = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('Live2D performance channels', () => {
  afterEach(() => vi.useRealTimers());

  it('queues actions FIFO and restores the latest state after the queue', async () => {
    const driver = new FakeDriver();
    const controller = new Live2DPerformanceController(driver, controls);
    await controller.start();

    const wave = controller.action.enqueue('wave');
    const nod = controller.action.enqueue('nod');
    await controller.state.set('thinking');
    expect(driver.calls).toEqual(['state:Idle', 'emotion:neutral', 'action:Wave']);

    driver.actionResolvers.shift()?.(true);
    await nextTurn();
    expect(driver.calls.at(-1)).toBe('action:Nod');
    driver.actionResolvers.shift()?.(true);

    await expect(Promise.all([wave, nod])).resolves.toEqual([true, true]);
    await nextTurn();
    expect(driver.calls.at(-1)).toBe('state:Thinking');
  });

  it('returns false for an unsupported action without disturbing state', async () => {
    const driver = new FakeDriver();
    const controller = new Live2DPerformanceController(driver, controls);
    await expect(controller.action.enqueue('missing')).resolves.toBe(false);
    expect(driver.calls).toEqual([]);
  });

  it('falls back to neutral when an expression cannot be applied', async () => {
    const driver = new FakeDriver();
    driver.rejectedExpressions.add('smile');
    const controller = new Live2DPerformanceController(driver, controls);

    await expect(controller.emotion.set('happy')).resolves.toBe(true);
    expect(controller.emotion.value).toBe('neutral');
    expect(driver.calls).toEqual(['emotion:smile', 'emotion:neutral']);
  });

  it('expires a WebP reply emotion after its short display window', async () => {
    vi.useFakeTimers();
    const driver = new FakeDriver();
    const controller = new Live2DPerformanceController(driver, controls, {
      transientEmotionMs: 4_000,
    });

    await controller.emotion.set('happy');
    expect(controller.emotion.value).toBe('happy');
    await vi.advanceTimersByTimeAsync(4_000);

    expect(controller.emotion.value).toBe('neutral');
    expect(driver.calls).toEqual(['emotion:smile', 'emotion:neutral']);
  });

  it('clamps tracking and resets it when disabled', () => {
    const driver = new FakeDriver();
    const controller = new Live2DPerformanceController(driver, controls);
    controller.tracking.move({ x: 8, y: -4 });
    controller.tracking.setEnabled(false);
    controller.tracking.move({ x: 0.5, y: 0.5 });

    expect(driver.tracking).toEqual([{ x: 1, y: -1 }]);
    expect(driver.calls).toContain('tracking:reset');
  });
});
