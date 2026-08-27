import { describe, expect, it, vi } from 'vitest';

import { WindowScaleSync } from '../src/renderer/settings/window-scale-sync';

describe('shared window scale synchronization', () => {
  it('keeps saved state, slider commits and runtime resizes on one authoritative value', async () => {
    let runtimeListener: ((scale: number) => void) | undefined;
    const display = vi.fn();
    const setWindowScale = vi.fn(
      async ({ scale }: { scale: number }) => Math.round(scale * 20) / 20,
    );
    const dispose = vi.fn();
    const sync = new WindowScaleSync(
      {
        getWindowScale: vi.fn(async () => 0.85),
        setWindowScale,
        onWindowScaleChanged: (listener) => {
          runtimeListener = listener;
          return dispose;
        },
      },
      display,
    );

    await expect(sync.load()).resolves.toBe(0.85);
    expect(display).toHaveBeenLastCalledWith(0.85);

    sync.preview(0.91);
    expect(setWindowScale).not.toHaveBeenCalled();
    expect(display).toHaveBeenLastCalledWith(0.91);

    await expect(sync.commit(0.93)).resolves.toBe(0.95);
    expect(setWindowScale).toHaveBeenCalledWith({ scale: 0.93 });
    expect(display).toHaveBeenLastCalledWith(0.95);

    runtimeListener?.(0.7);
    expect(display).toHaveBeenLastCalledWith(0.7);

    sync.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
