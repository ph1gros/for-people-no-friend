import { describe, expect, it } from 'vitest';

import {
  selectContextualRoleplayExamples,
  type CharacterLore,
} from '../src/core/character/character-lore';

const lore: CharacterLore = {
  canonicalName: '测试角色',
  aliases: [],
  sourceWork: '测试作品',
  identity: '',
  personality: '外冷内热、略显傲娇',
  background: '',
  relationships: [],
  speechStyle: '被戳穿时会羞恼，但不会恶意攻击。',
  roleplayExamples: [
    {
      scene: '中二台词被本人回忆',
      emotion: '羞耻又嘴硬',
      trigger: '用户引用她过去说过的“暗夜之翼听我号令”并调侃',
      attitude: '先羞恼否认，再用原本的傲娇语气接梗',
      line: '那、那只是战术口令！不准笑！',
    },
    {
      scene: '日常问候',
      emotion: '平静',
      trigger: '用户普通问候',
      attitude: '自然回应',
      line: '我在。',
    },
  ],
  sources: [],
};

describe('contextual roleplay selection', () => {
  it('uses current and recent context to match callbacks and explains the match', () => {
    const selected = selectContextualRoleplayExamples(lore, {
      query: '你刚才那句暗夜之翼听我号令也太中二了吧',
      recentMessages: ['她之前确实说过那句口号。'],
    });
    expect(selected[0]?.example.scene).toBe('中二台词被本人回忆');
    expect(selected[0]?.reasons.join('')).toMatch(/中二|示例台词/u);
  });

  it('honors a cooldown exclusion instead of repeating the same gag', () => {
    const first = selectContextualRoleplayExamples(lore, { query: '说说你的中二黑历史' });
    const second = selectContextualRoleplayExamples(lore, {
      query: '再说一次你的中二黑历史',
      excludedKeys: new Set(first.map(({ key }) => key)),
    });
    expect(second.some(({ example }) => example.scene === '中二台词被本人回忆')).toBe(false);
  });
});
