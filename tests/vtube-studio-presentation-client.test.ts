import { describe, expect, it, vi } from 'vitest';

import { VTubeStudioPresentationClient } from '../src/renderer/vtube-studio/vtube-studio-presentation-client';

describe('VTube Studio presentation client', () => {
  it('forwards only completed emotion and action intent to Main', async () => {
    const presentInVTubeStudio = vi.fn(async () => ({ ok: true, reason: 'presented' as const }));
    const client = new VTubeStudioPresentationClient({ presentInVTubeStudio });

    await expect(client.setState('talking')).resolves.toBe(true);
    await client.respond('happy', 'wave');

    expect(presentInVTubeStudio).toHaveBeenCalledTimes(2);
    expect(presentInVTubeStudio).toHaveBeenNthCalledWith(1, { state: 'talking' });
    expect(presentInVTubeStudio).toHaveBeenNthCalledWith(2, {
      emotion: 'happy',
      action: 'wave',
    });
  });

  it('returns a temporary expression to neutral after the completed reply becomes idle', async () => {
    vi.useFakeTimers();
    try {
      const presentInVTubeStudio = vi.fn(async () => ({ ok: true, reason: 'presented' as const }));
      const client = new VTubeStudioPresentationClient({ presentInVTubeStudio });

      await client.respond('angry');
      await client.setState('idle');
      await vi.advanceTimersByTimeAsync(7_999);
      expect(presentInVTubeStudio).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1);
      expect(presentInVTubeStudio).toHaveBeenLastCalledWith({ emotion: 'neutral' });
    } finally {
      vi.useRealTimers();
    }
  });
});
