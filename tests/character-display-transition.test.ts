import { describe, expect, it, vi } from 'vitest';

import { transitionCharacterDisplayMode } from '../src/renderer/display/character-display-transition';

describe('character display transition', () => {
  it('hides the old renderer before an external renderer can start', async () => {
    const events: string[] = [];

    await transitionCharacterDisplayMode({
      currentMode: 'live2d',
      targetMode: 'vtube-studio',
      applyLocalMode: (mode) => events.push(`local:${mode}`),
      persistMode: async (mode) => {
        events.push(`persist:${mode}`);
        return { ok: true as const, mode };
      },
    });

    expect(events).toEqual(['local:off', 'persist:vtube-studio', 'local:vtube-studio']);
  });

  it('restores the old renderer when the new mode cannot be saved', async () => {
    const events: string[] = [];

    await transitionCharacterDisplayMode({
      currentMode: 'live2d',
      targetMode: 'viewerex',
      applyLocalMode: (mode) => events.push(`local:${mode}`),
      persistMode: async (mode) => {
        events.push(`persist:${mode}`);
        return { ok: false as const, mode, message: 'failed' };
      },
    });

    expect(events).toEqual(['local:off', 'persist:viewerex', 'local:live2d']);
  });

  it('does not reload an unchanged renderer while saving other settings', async () => {
    const applyLocalMode = vi.fn();

    await transitionCharacterDisplayMode({
      currentMode: 'live2d',
      targetMode: 'live2d',
      applyLocalMode,
      persistMode: async (mode) => ({ ok: true as const, mode }),
    });

    expect(applyLocalMode).not.toHaveBeenCalled();
  });
});
