import { describe, expect, it, vi } from 'vitest';

import type { CharacterPresentationPort } from '../src/core/presentation/character-presentation';
import {
  AutonomousActivityPresentation,
  selectSafeAutonomousActions,
} from '../src/renderer/live2d/autonomous-activity';

const createPresentation = (): CharacterPresentationPort => ({
  setState: vi.fn(async () => true),
  respond: vi.fn(async () => undefined),
  updateSpeechLevel: vi.fn(),
  resetSpeech: vi.fn(),
});

describe('autonomous character activity', () => {
  it('only admits model-declared actions with emotionally neutral names', () => {
    expect(selectSafeAutonomousActions(['earWiggle', 'nod', 'surprised', 'angry', '眨眼'])).toEqual(
      ['earWiggle', 'nod', '眨眼'],
    );
  });

  it('performs a sparse action only while idle and defers to conversation state', async () => {
    vi.useFakeTimers();
    try {
      const base = createPresentation();
      const perform = vi.fn(async () => true);
      const presentation = new AutonomousActivityPresentation(
        base,
        ['earWiggle'],
        perform,
        () => 0,
        {
          firstDelayMinMs: 100,
          firstDelayRangeMs: 0,
          repeatDelayMinMs: 200,
          repeatDelayRangeMs: 0,
        },
      );
      presentation.start();
      await vi.advanceTimersByTimeAsync(100);
      expect(perform).toHaveBeenCalledWith('earWiggle');

      await presentation.setState('thinking');
      await vi.advanceTimersByTimeAsync(200);
      expect(perform).toHaveBeenCalledTimes(1);

      await presentation.setState('idle');
      await vi.advanceTimersByTimeAsync(199);
      expect(perform).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(perform).toHaveBeenCalledTimes(2);
      presentation.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not schedule an unsafe or unsupported action', async () => {
    vi.useFakeTimers();
    try {
      const perform = vi.fn(async () => true);
      const presentation = new AutonomousActivityPresentation(
        createPresentation(),
        ['surprised', 'angry'],
        perform,
        () => 0,
        {
          firstDelayMinMs: 1,
          firstDelayRangeMs: 0,
          repeatDelayMinMs: 1,
          repeatDelayRangeMs: 0,
        },
      );
      presentation.start();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(perform).not.toHaveBeenCalled();
      presentation.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
