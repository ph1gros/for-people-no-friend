import { describe, expect, it } from 'vitest';

import {
  buildConversationSystemPrompt,
  selectRecentMessages,
} from '../src/core/conversation/context-assembler';
import { DEFAULT_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';
import { IRENA_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';

describe('conversation context assembly', () => {
  it('keeps only the newest bounded messages in chronological order', () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `message-${index}`,
    }));
    const selected = selectRecentMessages(messages);

    expect(selected).toHaveLength(12);
    expect(selected[0]?.content).toBe('message-18');
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
    expect(prompt).not.toContain('跨会话摘要');
  });

  it('adds temporary emotional guidance without turning it into relationship memory', () => {
    const prompt = buildConversationSystemPrompt(
      IRENA_CHARACTER_PROFILE,
      ['angry'],
      '',
      '你就是个大傻逼',
    );
    expect(prompt).toContain('本轮回应策略');
    expect(prompt).toContain('明确设限');
    expect(prompt).toContain('不得因单轮情绪、辱骂或夸奖突然跳变');
    expect(prompt).toContain('不写入长期人格、关系等级或用户画像');
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
    expect(casualPrompt).not.toContain(DEFAULT_CHARACTER_PROFILE.bio);
    expect(casualPrompt).not.toContain(DEFAULT_CHARACTER_PROFILE.personaPrompt);
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

  it('keeps user-written profile fields alongside structured lore', () => {
    const prompt = buildConversationSystemPrompt(
      {
        ...DEFAULT_CHARACTER_PROFILE,
        name: 'Mon3tr',
        bio: '凯尔希的重要同伴。',
        personaPrompt: '称呼用户为博士。',
        lore: {
          canonicalName: 'Mon3tr',
          aliases: ['M3'],
          sourceWork: '明日方舟',
          identity: '由凯尔希召唤的神秘存在',
          personality: '警觉而克制',
          background: '',
          relationships: [],
          speechStyle: '简短回应',
          sources: [],
        },
      },
      [],
    );
    expect(prompt).toContain('角色简介：凯尔希的重要同伴。');
    expect(prompt).toContain('人格规则：');
    expect(prompt).toContain('称呼用户为博士。');
  });

  it('does not repeat a shared role introduction as a separate identity', () => {
    const sharedIntroduction = '罗德岛的机械生命体。';
    const prompt = buildConversationSystemPrompt(
      {
        ...DEFAULT_CHARACTER_PROFILE,
        name: 'Mon3tr',
        bio: sharedIntroduction,
        lore: {
          canonicalName: 'Mon3tr',
          aliases: [],
          sourceWork: '明日方舟',
          identity: sharedIntroduction,
          personality: '警觉而克制',
          background: '',
          relationships: [],
          speechStyle: '简短回应',
          sources: [],
        },
      },
      [],
    );

    expect(prompt.match(new RegExp(sharedIntroduction, 'gu'))).toHaveLength(1);
    expect(prompt).not.toContain(`角色简介：${sharedIntroduction}`);
  });

  it('selects a few situation-matched roleplay examples instead of injecting the whole card', () => {
    const prompt = buildConversationSystemPrompt(
      IRENA_CHARACTER_PROFILE,
      [],
      '',
      '我今天失败了，有点难过，能陪我聊聊吗？',
    );

    expect(prompt).toContain('当前对话可参考的角色反应');
    expect(prompt).toContain('用户情绪低落');
    expect(prompt).toContain('别担心，我会看着你的。');
    expect(prompt).not.toContain('事情似乎更有趣了。');
    expect(prompt.match(/^- 场景：/gmu)).toHaveLength(2);
  });
});
