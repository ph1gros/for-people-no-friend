import { describe, expect, it } from 'vitest';

import { resolveCharacterDisplayName } from '../src/core/conversation/character-identity';

describe('character display identity', () => {
  it('prefers a configured character-card name', () => {
    expect(resolveCharacterDisplayName('凯尔希', 'Live2D 模型名')).toBe('凯尔希');
  });

  it('uses the Live2D name when the profile still has the fallback name', () => {
    expect(resolveCharacterDisplayName('桌宠', '阿米娅')).toBe('阿米娅');
  });

  it('falls back to 桌宠 only when neither source has a name', () => {
    expect(resolveCharacterDisplayName('  ', '  ')).toBe('桌宠');
  });
});
