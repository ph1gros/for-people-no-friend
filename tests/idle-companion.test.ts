import { describe, expect, it, vi } from 'vitest';

import {
  IdleCompanionScheduler,
  selectKittenDrowsyLine,
} from '../src/renderer/chat/idle-companion';

describe('idle companion', () => {
  it('fires once after a full quiet period and rearms after interaction', async () => {
    vi.useFakeTimers();
    try {
      const onIdle = vi.fn();
      const scheduler = new IdleCompanionScheduler(onIdle, 300);
      scheduler.start();
      await vi.advanceTimersByTimeAsync(299);
      expect(onIdle).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(onIdle).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(onIdle).toHaveBeenCalledTimes(1);
      scheduler.reset();
      await vi.advanceTimersByTimeAsync(300);
      expect(onIdle).toHaveBeenCalledTimes(2);
      scheduler.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('chooses only bounded local phrases without a model request', () => {
    expect(selectKittenDrowsyLine(() => 0)).toEqual({
      displayText: expect.stringContaining('睡着'),
      speechText: expect.stringContaining('寝ちゃいそう'),
    });
    expect(selectKittenDrowsyLine(() => 1)).toEqual({
      displayText: expect.stringContaining('叫我'),
      speechText: expect.stringContaining('起こして'),
    });
  });
});
