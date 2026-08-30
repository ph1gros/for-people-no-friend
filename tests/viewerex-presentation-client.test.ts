import { describe, expect, it, vi } from 'vitest';

import type { DeskpetApi } from '../src/shared/ipc';
import { ViewerExPresentationClient } from '../src/renderer/viewerex/viewerex-presentation-client';

describe('ViewerEX presentation client', () => {
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
