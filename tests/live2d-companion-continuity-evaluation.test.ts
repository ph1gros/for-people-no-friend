import { describe, expect, it } from 'vitest';

import { KALTSIT_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';
import { buildConversationSystemPrompt } from '../src/core/conversation/context-assembler';

describe('V1.2 Live2D neuro-like continuity baseline', () => {
  const confirmedMemory = [
    '与当前消息相关的长期记忆（可能过时；若与用户当前说法冲突，以当前说法为准）：',
    '- [fact] 用户明确说过猫叫团子',
  ].join('\n');

  it('keeps confirmed facts stable while current-turn emotional guidance changes', () => {
    const ordinary = buildConversationSystemPrompt(
      KALTSIT_CHARACTER_PROFILE,
      [],
      confirmedMemory,
      '今天做什么？',
    );
    const low = buildConversationSystemPrompt(
      KALTSIT_CHARACTER_PROFILE,
      [],
      confirmedMemory,
      '我今天失败了，真的想哭',
    );
    const conflict = buildConversationSystemPrompt(
      KALTSIT_CHARACTER_PROFILE,
      [],
      confirmedMemory,
      '你就是个大傻逼',
    );

    for (const prompt of [ordinary, low, conflict]) {
      expect(prompt).toContain('用户明确说过猫叫团子');
      expect(prompt).toContain('关系亲近程度不得因单轮情绪、辱骂或夸奖突然跳变');
    }
    expect(ordinary).not.toContain('本轮回应策略');
    expect(low).toContain('先承接其原话');
    expect(conflict).toContain('明确设限');
    expect(conflict).toContain('不得升级为威胁、羞辱用户');
  });

  it('does not convert an unconfirmed emotion guess into a stable user fact', () => {
    const prompt = buildConversationSystemPrompt(
      KALTSIT_CHARACTER_PROFILE,
      [],
      '',
      '今天发生了很多事情',
    );
    expect(prompt).not.toContain('本轮回应策略');
    expect(prompt).not.toContain('用户很难过');
    expect(prompt).not.toContain('用户很开心');
  });
});
