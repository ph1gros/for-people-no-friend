import { describe, expect, it } from 'vitest';

import {
  deriveCurrentEmotionalSignal,
  deriveRecentMoodContinuity,
  formatLive2DCompanionSignals,
  resolveCompanionReplyEmotion,
} from '../src/core/conversation/companion-signals';

describe('Live2D companion emotion signals', () => {
  it('derives conservative current-turn guidance from explicit user wording', () => {
    expect(deriveCurrentEmotionalSignal('我今天失败了，真的想哭')).toMatchObject({
      mode: 'support',
      confidence: 'explicit',
    });
    expect(deriveCurrentEmotionalSignal('我终于完成了！')).toMatchObject({
      mode: 'celebrate',
    });
    expect(deriveCurrentEmotionalSignal('你就是个大傻逼')).toMatchObject({ mode: 'boundary' });
  });

  it('does not label ambiguous everyday messages as emotions', () => {
    expect(deriveCurrentEmotionalSignal('今天发生了很多事')).toBeUndefined();
    expect(deriveCurrentEmotionalSignal('你觉得这个计划怎么样？')).toBeUndefined();
  });

  it('keeps relationship continuity separate from temporary emotion', () => {
    const context = formatLive2DCompanionSignals('你就是个大傻逼', [
      { role: 'user', content: '你就是个大傻逼' },
    ]);
    expect(context).toContain('只把已确认长期记忆当作稳定用户事实');
    expect(context).toContain('不得因单轮情绪、辱骂或夸奖突然跳变');
    expect(context).toContain('最近四条对话记录');
    expect(context).toContain('本条明确触发');
    expect(context).toContain('明确设限');
  });

  it('carries a clear mood through the rolling four-record window', () => {
    expect(
      deriveRecentMoodContinuity([
        { role: 'user', content: '你就是个大傻逼' },
        { role: 'assistant', content: '请注意措辞。' },
        { role: 'user', content: '那继续说刚才的事吧' },
      ]),
    ).toEqual({
      emotion: 'angry',
      mode: 'boundary',
      source: 'carried',
      contributingRecords: 1,
    });
  });

  it('lets a newer explicit mood override an older one and expires old cues', () => {
    expect(
      deriveRecentMoodContinuity([
        { role: 'user', content: '你就是个大傻逼' },
        { role: 'assistant', content: '请注意措辞。' },
        { role: 'user', content: '我终于完成了！' },
      ]),
    ).toMatchObject({ emotion: 'happy', source: 'current' });
    expect(
      deriveRecentMoodContinuity([
        { role: 'assistant', content: '旧心情已经离开窗口。' },
        { role: 'user', content: '继续吧' },
        { role: 'assistant', content: '好。' },
        { role: 'user', content: '下一步是什么？' },
      ]),
    ).toBeUndefined();
  });

  it('makes an explicit current cue authoritative for the visible reply emotion', () => {
    expect(
      resolveCompanionReplyEmotion('neutral', [
        { role: 'assistant', content: '我们继续。' },
        { role: 'user', content: '你就是个大傻逼' },
      ]),
    ).toBe('angry');
    expect(
      resolveCompanionReplyEmotion('happy', [{ role: 'user', content: '我今天失败了，真的想哭' }]),
    ).toBe('sad');
  });

  it('uses carried mood only to fill neutral and lets a new non-neutral reply move on', () => {
    const recent = [
      { role: 'user' as const, content: '你就是个大傻逼' },
      { role: 'assistant' as const, content: '请注意措辞。' },
      { role: 'user' as const, content: '那继续说刚才的事吧' },
    ];
    expect(resolveCompanionReplyEmotion('neutral', recent)).toBe('angry');
    expect(resolveCompanionReplyEmotion('playful', recent)).toBe('playful');
  });
});
