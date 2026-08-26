import { describe, expect, it } from 'vitest';

import {
  buildConversationSystemPrompt,
  selectRecentMessages,
} from '../src/core/conversation/context-assembler';
import { DEFAULT_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';

describe('conversation context assembly', () => {
  it('keeps only the newest bounded messages in chronological order', () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `message-${index}`,
    }));
    const selected = selectRecentMessages(messages);

    expect(selected).toHaveLength(20);
    expect(selected[0]?.content).toBe('message-10');
    expect(selected.at(-1)?.content).toBe('message-29');
  });

  it('does not exceed the character budget after retaining the newest message', () => {
    const selected = selectRecentMessages(
      [
        { role: 'user', content: 'a'.repeat(10) },
        { role: 'assistant', content: 'b'.repeat(10) },
        { role: 'user', content: 'latest' },
      ],
      20,
      12,
    );
    expect(selected).toEqual([{ role: 'user', content: 'latest' }]);
  });

  it('separates stable persona from the strict reply envelope', () => {
    const prompt = buildConversationSystemPrompt(DEFAULT_CHARACTER_PROFILE, ['wave']);
    expect(prompt).toContain(DEFAULT_CHARACTER_PROFILE.personaPrompt);
    expect(prompt).toContain('"emotion"');
    expect(prompt).toContain('wave');
    expect(prompt).not.toContain('长期记忆');
  });

  it('uses locally entered character identity silently and only adds long lore when relevant', () => {
    const profile = {
      ...DEFAULT_CHARACTER_PROFILE,
      name: '芙宁娜',
      lore: {
        canonicalName: '芙宁娜',
        aliases: ['Furina'],
        sourceWork: '原神',
        identity: '枫丹的重要角色',
        personality: '富有表现力',
        background: '这是一段较长的原作背景。',
        relationships: ['与那维莱特共事'],
        speechStyle: '自信而有舞台感',
        sources: [],
      },
    };
    const casualPrompt = buildConversationSystemPrompt(profile, [], '', '今天过得怎么样？');
    expect(casualPrompt).toContain('富有表现力');
    expect(casualPrompt).toContain('必须遵循的角色说话方式：自信而有舞台感');
    expect(casualPrompt).toContain('自然采用上述称呼、语气、句式和措辞');
    expect(casualPrompt).toContain('角色本人而不是角色资料解说员');
    expect(casualPrompt).toContain('禁止只在通用答案的开头或结尾添加角色称呼');
    expect(casualPrompt).toContain('通常用二至五句话直接回应');
    expect(casualPrompt).toContain('不得把训练知识冒充为当前事实');
    expect(casualPrompt).toContain('存在多个合理含义');
    expect(casualPrompt).toContain('普通对话不能静默联网查词');
    expect(casualPrompt).toContain('客服式反问收尾');
    expect(casualPrompt).not.toContain('较长的原作背景');

    const lorePrompt = buildConversationSystemPrompt(profile, [], '', '你在原神里是什么身份？');
    expect(lorePrompt).toContain('较长的原作背景');
    expect(lorePrompt).toContain('与那维莱特共事');
  });
});
