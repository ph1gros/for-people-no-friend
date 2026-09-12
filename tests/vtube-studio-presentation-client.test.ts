import { describe, expect, it, vi } from 'vitest';

import { VTubeStudioPresentationClient } from '../src/renderer/vtube-studio/vtube-studio-presentation-client';
import { parseEmotionChannels } from '../src/core/character/emotion-channels';

describe('VTube Studio presentation client', () => {
  it('ignores an idle response from before disposal after the client is reused', async () => {
    vi.useFakeTimers();
    try {
      const idleResponse = Promise.withResolvers<{ ok: true; reason: 'presented' }>();
      const presentInVTubeStudio = vi.fn(async () => ({ ok: true, reason: 'presented' as const }));
      const client = new VTubeStudioPresentationClient({ presentInVTubeStudio });
      await client.respond('happy');
      presentInVTubeStudio.mockReturnValueOnce(idleResponse.promise);
      const pendingIdle = client.setState('idle');
      client.dispose();
      await client.respond('sad');
      idleResponse.resolve({ ok: true, reason: 'presented' });
      await pendingIdle;
      await vi.advanceTimersByTimeAsync(8000);
      expect(presentInVTubeStudio).not.toHaveBeenCalledWith({ emotion: 'neutral' });
    } finally {
      vi.useRealTimers();
    }
  });
  it('cancels expression recovery when disposed and starts clean when reused', async () => {
    vi.useFakeTimers();
    try {
      const presentInVTubeStudio = vi.fn(async () => ({ ok: true, reason: 'presented' as const }));
      const client = new VTubeStudioPresentationClient({ presentInVTubeStudio });
      await client.respond('happy', undefined, parseEmotionChannels({ joy: 0.5 }));
      await client.setState('idle');
      client.dispose();
      await vi.advanceTimersByTimeAsync(8000);
      expect(presentInVTubeStudio).not.toHaveBeenCalledWith({ emotion: 'neutral' });
      await client.setState('idle');
      await vi.advanceTimersByTimeAsync(8000);
      expect(presentInVTubeStudio).not.toHaveBeenCalledWith({ emotion: 'neutral' });
      await client.respond('sad');
      await client.setState('idle');
      await vi.advanceTimersByTimeAsync(8000);
      expect(presentInVTubeStudio).toHaveBeenLastCalledWith({ emotion: 'neutral' });
    } finally {
      vi.useRealTimers();
    }
  });
  it('does not let a delayed idle response reset a newer reply before it becomes idle', async () => {
    vi.useFakeTimers();
    try {
      const idleResponse = Promise.withResolvers<{ ok: true; reason: 'presented' }>();
      const presentInVTubeStudio = vi.fn(async () => ({ ok: true, reason: 'presented' as const }));
      const client = new VTubeStudioPresentationClient({ presentInVTubeStudio });
      await client.respond('happy');
      presentInVTubeStudio.mockReturnValueOnce(idleResponse.promise);
      const pendingIdle = client.setState('idle');
      await client.respond('sad');
      idleResponse.resolve({ ok: true, reason: 'presented' });
      await pendingIdle;
      await vi.advanceTimersByTimeAsync(8000);
      expect(presentInVTubeStudio).not.toHaveBeenCalledWith({ emotion: 'neutral' });
      await client.setState('idle');
      await vi.advanceTimersByTimeAsync(8000);
      expect(presentInVTubeStudio).toHaveBeenLastCalledWith({ emotion: 'neutral' });
    } finally {
      vi.useRealTimers();
    }
  });
  it('does not let a delayed idle response reset a newer thinking state', async () => {
    vi.useFakeTimers();
    try {
      const idleResponse = Promise.withResolvers<{ ok: true; reason: 'presented' }>();
      const presentInVTubeStudio = vi.fn(async () => ({ ok: true, reason: 'presented' as const }));
      const client = new VTubeStudioPresentationClient({ presentInVTubeStudio });
      await client.respond('happy');
      presentInVTubeStudio.mockReturnValueOnce(idleResponse.promise);
      const pendingIdle = client.setState('idle');
      await client.setState('thinking');
      idleResponse.resolve({ ok: true, reason: 'presented' });
      await pendingIdle;
      await vi.advanceTimersByTimeAsync(8000);
      expect(presentInVTubeStudio).not.toHaveBeenCalledWith({ emotion: 'neutral' });
    } finally {
      vi.useRealTimers();
    }
  });
  it('forwards mixed channels and resets them even with a neutral compatibility label', async () => {
    vi.useFakeTimers();
    try {
      const presentInVTubeStudio = vi.fn(async () => ({ ok: true, reason: 'presented' as const }));
      const client = new VTubeStudioPresentationClient({ presentInVTubeStudio });
      const emotionChannels = parseEmotionChannels({ fear: 0.5, guilt: 0.2 });
      await client.respond('neutral', undefined, emotionChannels);
      expect(presentInVTubeStudio).toHaveBeenLastCalledWith({
        emotion: 'neutral',
        emotionChannels,
      });
      await client.setState('idle');
      await vi.advanceTimersByTimeAsync(8000);
      expect(presentInVTubeStudio).toHaveBeenLastCalledWith({ emotion: 'neutral' });
    } finally {
      vi.useRealTimers();
    }
  });
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
