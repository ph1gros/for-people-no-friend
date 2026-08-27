import { describe, expect, it, vi } from 'vitest';

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
  emotionActions: { angry: 'nod' },
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

  it('cools down repeated one-shot actions without blocking a different action', async () => {
    const driver = new FakeDriver();
    let now = 1_000;
    const controller = new Live2DPerformanceController(
      driver,
      controls,
      { actionTimeoutMs: 12_000, actionCooldownMs: 1_200, recoveryDelayMs: 0 },
      () => now,
    );

    const first = controller.action.enqueue('wave');
    await expect(controller.action.enqueue('wave')).resolves.toBe(false);
    const different = controller.action.enqueue('nod');
    driver.actionResolvers.shift()?.(true);
    await nextTurn();
    driver.actionResolvers.shift()?.(true);
    await expect(Promise.all([first, different])).resolves.toEqual([true, true]);

    now += 1_200;
    const afterCooldown = controller.action.enqueue('wave');
    driver.actionResolvers.shift()?.(true);
    await expect(afterCooldown).resolves.toBe(true);
  });

  it('restores the latest state when a one-shot action times out', async () => {
    vi.useFakeTimers();
    try {
      const driver = new FakeDriver();
      const controller = new Live2DPerformanceController(driver, controls, {
        actionTimeoutMs: 100,
        actionCooldownMs: 0,
        recoveryDelayMs: 0,
      });
      await controller.state.set('thinking');
      const action = controller.action.enqueue('wave');

      await vi.advanceTimersByTimeAsync(100);

      await expect(action).resolves.toBe(false);
      await nextTurn();
      expect(driver.calls.at(-1)).toBe('state:Thinking');
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to neutral when an expression cannot be applied', async () => {
    const driver = new FakeDriver();
    driver.rejectedExpressions.add('smile');
    const controller = new Live2DPerformanceController(driver, controls);

    await expect(controller.emotion.set('happy')).resolves.toBe(true);
    expect(controller.emotion.value).toBe('neutral');
    expect(driver.calls).toEqual(['emotion:smile', 'emotion:neutral']);
  });

  it('uses a model-declared motion when an emotion has no expression', async () => {
    const driver = new FakeDriver();
    const controller = new Live2DPerformanceController(driver, controls);

    await controller.respond('angry');

    expect(driver.calls).toEqual(['emotion:neutral', 'action:Nod']);
    driver.actionResolvers.shift()?.(true);
  });

  it('prefers an explicitly requested action over the emotion fallback', async () => {
    const driver = new FakeDriver();
    const controller = new Live2DPerformanceController(driver, controls);

    await controller.respond('angry', 'wave');

    expect(driver.calls).toEqual(['emotion:neutral', 'action:Wave']);
    driver.actionResolvers.shift()?.(true);
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
