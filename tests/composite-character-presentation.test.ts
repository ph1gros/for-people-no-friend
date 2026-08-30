import { describe, expect, it, vi } from 'vitest';

import {
  CompositeCharacterPresentation,
  type CharacterPresentationPort,
} from '../src/core/presentation/character-presentation';

const createPort = (): CharacterPresentationPort => ({
  setState: vi.fn(async () => true),
  respond: vi.fn(async () => undefined),
  updateSpeechLevel: vi.fn(),
  resetSpeech: vi.fn(),
});

describe('composite character presentation', () => {
  it('fans intent out to built-in and external displays', async () => {
    const builtIn = createPort();
    const external = createPort();
    const presentation = new CompositeCharacterPresentation([builtIn, external]);

    await expect(presentation.setState('talking')).resolves.toBe(true);
    await presentation.respond('happy', 'wave');
    presentation.updateSpeechLevel(0.5);
    presentation.resetSpeech();

    expect(builtIn.setState).toHaveBeenCalledWith('talking');
    expect(external.respond).toHaveBeenCalledWith('happy', 'wave');
    expect(builtIn.updateSpeechLevel).toHaveBeenCalledWith(0.5);
    expect(external.resetSpeech).toHaveBeenCalledOnce();
  });

  it('keeps one display failure from blocking another', async () => {
    const failing = createPort();
    const healthy = createPort();
    vi.mocked(failing.setState).mockRejectedValue(new Error('offline'));
    vi.mocked(failing.respond).mockRejectedValue(new Error('offline'));
    vi.mocked(failing.updateSpeechLevel).mockImplementation(() => {
      throw new Error('offline');
    });

    const presentation = new CompositeCharacterPresentation([failing, healthy]);
    await expect(presentation.setState('thinking')).resolves.toBe(true);
    await expect(presentation.respond('neutral')).resolves.toBeUndefined();
    expect(() => presentation.updateSpeechLevel(0.2)).not.toThrow();
    expect(healthy.setState).toHaveBeenCalledWith('thinking');
    expect(healthy.updateSpeechLevel).toHaveBeenCalledWith(0.2);
  });
});
