import { describe, expect, it } from 'vitest';

import {
  deriveCurrentEmotionalSignal,
  formatLive2DCompanionSignals,
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
    const context = formatLive2DCompanionSignals('你就是个大傻逼');
    expect(context).toContain('只把已确认长期记忆当作稳定用户事实');
    expect(context).toContain('不得因单轮情绪、辱骂或夸奖突然跳变');
    expect(context).toContain('只影响当前回复语气与表现');
    expect(context).toContain('明确设限');
  });
});
