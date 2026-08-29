import { describe, expect, it } from 'vitest';

import {
  NativeInputActivityMonitor,
  type NativeInputHook,
  type NativeInputHookModule,
} from '../src/main/desktop/native-input-activity-monitor';
import type { DesktopInputActivityEvent } from '../src/shared/desktop-integration-ipc';

class FakeHook {
  public starts = 0;
  public stops = 0;
  private readonly listeners = new Map<string, Set<(event: never) => void>>();

  public on(event: string, listener: (event: never) => void): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  public off(event: string, listener: (event: never) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  public emit(event: string, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value as never);
  }

  public start(): void {
    this.starts += 1;
  }

  public stop(): void {
    this.stops += 1;
  }
}

const createModule = (hook: FakeHook): NativeInputHookModule => ({
  uIOhook: hook as unknown as NativeInputHook,
  UiohookKey: { W: 17, A: 30, S: 31, D: 32, Q: 16 },
});

describe('native input activity monitor', () => {
  it('emits only configured keys, three mouse buttons, and quantized direction without coordinates', async () => {
    const hook = new FakeHook();
    let now = 100;
    const events: DesktopInputActivityEvent[] = [];
    const monitor = new NativeInputActivityMonitor(
      async () => createModule(hook),
      () => now,
    );

    await expect(
      monitor.start(
        { inputOverlayKeys: ['W', 'A', 'S', 'D'], inputOverlayMouseEnabled: true },
        (event) => events.push(event),
      ),
    ).resolves.toBe(true);

    hook.emit('keydown', { keycode: 17 });
    hook.emit('keydown', { keycode: 17 });
    hook.emit('keydown', { keycode: 16 });
    hook.emit('keyup', { keycode: 17 });
    hook.emit('mousedown', { button: 1, x: 10, y: 10 });
    hook.emit('mouseup', { button: 1, x: 10, y: 10 });
    hook.emit('mousedown', { button: 4, x: 10, y: 10 });
    hook.emit('mousemove', { button: 0, x: 100, y: 100 });
    now = 200;
    hook.emit('mousemove', { button: 0, x: 120, y: 100 });

    expect(events).toEqual([
      { type: 'key', key: 'W', pressed: true },
      { type: 'key', key: 'W', pressed: false },
      { type: 'mouse-button', button: 'left', pressed: true },
      { type: 'mouse-button', button: 'left', pressed: false },
      { type: 'mouse-direction', direction: 'right' },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/"[xy]"/u);

    monitor.stop();
    expect(hook.starts).toBe(1);
    expect(hook.stops).toBe(1);
    hook.emit('keydown', { keycode: 17 });
    expect(events).toHaveLength(5);
  });

  it('can keep keyboard display enabled while suppressing all mouse events', async () => {
    const hook = new FakeHook();
    const events: DesktopInputActivityEvent[] = [];
    const monitor = new NativeInputActivityMonitor(
      async () => createModule(hook),
      () => 100,
    );

    await monitor.start({ inputOverlayKeys: ['A'], inputOverlayMouseEnabled: false }, (event) =>
      events.push(event),
    );
    hook.emit('keydown', { keycode: 30 });
    hook.emit('mousedown', { button: 2, x: 0, y: 0 });
    hook.emit('mousemove', { button: 0, x: 50, y: 50 });

    expect(events).toEqual([{ type: 'key', key: 'A', pressed: true }]);
  });

  it('fails closed when the native hook cannot be loaded', async () => {
    const monitor = new NativeInputActivityMonitor(async () => {
      throw new Error('fake native module failure');
    });

    await expect(
      monitor.start({ inputOverlayKeys: ['W'], inputOverlayMouseEnabled: true }, () => undefined),
    ).resolves.toBe(false);
  });
});
