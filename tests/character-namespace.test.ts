import { describe, expect, it } from 'vitest';

import { KALTSIT_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';
import { resolveCharacterMemoryNamespace } from '../src/main/character/character-namespace';

describe('character memory namespace', () => {
  it('keeps the bundled Kaltsit namespace and derives stable isolated custom namespaces', () => {
    expect(resolveCharacterMemoryNamespace(KALTSIT_CHARACTER_PROFILE)).toBe('character-kaltsit');
    const furina = {
      ...KALTSIT_CHARACTER_PROFILE,
      name: '芙宁娜',
      lore: {
        ...KALTSIT_CHARACTER_PROFILE.lore!,
        canonicalName: '芙宁娜',
        sourceWork: '原神',
      },
    };
    const keqing = {
      ...furina,
      name: '刻晴',
      lore: { ...furina.lore, canonicalName: '刻晴' },
    };
    expect(resolveCharacterMemoryNamespace(furina)).toMatch(/^character-[a-f0-9]{24}$/u);
    expect(resolveCharacterMemoryNamespace(furina)).toBe(resolveCharacterMemoryNamespace(furina));
    expect(resolveCharacterMemoryNamespace(furina)).not.toBe(
      resolveCharacterMemoryNamespace(keqing),
    );
  });
});
