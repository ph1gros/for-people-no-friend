import { describe, expect, it } from 'vitest';

import { IRENA_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';
import { resolveCharacterMemoryNamespace } from '../src/main/character/character-namespace';

describe('character memory namespace', () => {
  it('keeps the bundled Irena namespace and derives stable isolated custom namespaces', () => {
    expect(resolveCharacterMemoryNamespace(IRENA_CHARACTER_PROFILE)).toBe('character-irena');
    const frieren = {
      ...IRENA_CHARACTER_PROFILE,
      name: '芙莉莲',
      lore: {
        ...IRENA_CHARACTER_PROFILE.lore!,
        canonicalName: '芙莉莲',
        sourceWork: '葬送的芙莉莲',
      },
    };
    const fern = {
      ...frieren,
      name: '菲伦',
      lore: { ...frieren.lore, canonicalName: '菲伦' },
    };
    expect(resolveCharacterMemoryNamespace(frieren)).toMatch(/^character-[a-f0-9]{24}$/u);
    expect(resolveCharacterMemoryNamespace(frieren)).toBe(resolveCharacterMemoryNamespace(frieren));
    expect(resolveCharacterMemoryNamespace(frieren)).not.toBe(
      resolveCharacterMemoryNamespace(fern),
    );
  });
});
