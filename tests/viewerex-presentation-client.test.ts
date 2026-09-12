import { describe, expect, it, vi } from 'vitest';

import type { DeskpetApi } from '../src/shared/ipc';
import { ViewerExPresentationClient } from '../src/renderer/viewerex/viewerex-presentation-client';

describe('ViewerEX presentation client', () => {
  it('lets the gesture play before idle, then restores neutral without leaking an old reset into a new turn', async () => {
    vi.useFakeTimers();
    try {
      const presentInViewerEx = vi.fn(async () => true);
      const client = new ViewerExPresentationClient({ presentInViewerEx });
      await client.respond('happy');
      await client.setState('idle');
      expect(presentInViewerEx).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1500);
      expect(presentInViewerEx).toHaveBeenLastCalledWith({ state: 'idle' });
      await vi.advanceTimersByTimeAsync(6500);
      expect(presentInViewerEx).toHaveBeenLastCalledWith({ emotion: 'neutral' });
      await client.respond('sad');
      await client.setState('idle');
      await client.setState('thinking');
      await vi.advanceTimersByTimeAsync(8000);
      expect(presentInViewerEx).toHaveBeenLastCalledWith({ state: 'thinking' });
      await client.respond('happy');
      await client.setState('idle');
      client.dispose();
      const callsBefore = presentInViewerEx.mock.calls.length;
      await vi.advanceTimersByTimeAsync(8000);
      expect(presentInViewerEx.mock.calls).toHaveLength(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });
  it('sends only bounded high-level intent through the preload API', async () => {
    const presentInViewerEx = vi.fn(async () => true);
    const client = new ViewerExPresentationClient({ presentInViewerEx } as unknown as DeskpetApi);

    await expect(client.setState('thinking')).resolves.toBe(true);
    await client.respond('happy', 'wave');
    client.updateSpeechLevel(0.8);
    client.resetSpeech();

    expect(presentInViewerEx).toHaveBeenNthCalledWith(1, { state: 'thinking' });
    expect(presentInViewerEx).toHaveBeenNthCalledWith(2, { emotion: 'happy', action: 'wave' });
    expect(presentInViewerEx).toHaveBeenCalledTimes(2);
  });

  it('fails softly when ViewerEX is offline', async () => {
    const client = new ViewerExPresentationClient({
      presentInViewerEx: async () => {
        throw new Error('offline');
      },
    } as unknown as DeskpetApi);

    await expect(client.setState('idle')).resolves.toBe(false);
    await expect(client.respond('neutral')).resolves.toBeUndefined();
  });
});
