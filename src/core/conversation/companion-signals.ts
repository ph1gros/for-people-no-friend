export type EmotionalResponseMode = 'support' | 'celebrate' | 'boundary' | 'reassure';

export interface CurrentEmotionalSignal {
  mode: EmotionalResponseMode;
  confidence: 'explicit' | 'strong-cue';
  matchedCues: string[];
}

interface SignalRule {
  mode: EmotionalResponseMode;
  confidence: CurrentEmotionalSignal['confidence'];
  cues: readonly string[];
}

const SIGNAL_RULES: readonly SignalRule[] = [
  {
    mode: 'boundary',
    confidence: 'explicit',
    cues: ['傻逼', '蠢货', '废物', '闭嘴', '滚开', '讨厌你', '骂你', '侮辱'],
  },
  {
    mode: 'support',
    confidence: 'explicit',
    cues: ['我很难过', '我好难过', '想哭', '我失败了', '我撑不住', '陪陪我', '安慰我'],
  },
  {
    mode: 'celebrate',
    confidence: 'explicit',
    cues: ['我成功了', '我做到了', '通过了', '完成了', '好开心', '太好了'],
  },
  {
    mode: 'reassure',
    confidence: 'strong-cue',
    cues: ['我害怕', '我好怕', '有点慌', '很焦虑', '很担心'],
  },
];

const normalize = (value: string): string => value.normalize('NFKC').trim().toLowerCase();

export const deriveCurrentEmotionalSignal = (
  message: string,
): CurrentEmotionalSignal | undefined => {
  const normalized = normalize(message);
  if (!normalized || normalized.length > 8_000) return undefined;
  for (const rule of SIGNAL_RULES) {
    const matchedCues = rule.cues.filter((cue) => normalized.includes(cue));
    if (matchedCues.length > 0) {
      return { mode: rule.mode, confidence: rule.confidence, matchedCues };
    }
  }
  return undefined;
};

const MODE_GUIDANCE: Record<EmotionalResponseMode, string> = {
  support:
    '用户明确表达低落或需要陪伴。先承接其原话，再给一个小而具体的回应；不要诊断、夸大痛苦或用空泛鸡汤覆盖事实。',
  celebrate:
    '用户明确分享进展或喜悦。先肯定具体成果，再自然回应；不要突然转为说教，也不要凭空添加未发生的成就。',
  boundary:
    '当前消息含直接辱骂或驱赶。角色可以明确设限并表现不满，但不得升级为威胁、羞辱用户或把一次冲突永久解释为关系恶化。',
  reassure:
    '用户明确表达害怕、焦虑或担心。先确认具体担忧和当下需要；不要假装已经知道原因，也不要给出未经证实的保证。',
};

export const formatLive2DCompanionSignals = (message: string): string => {
  const signal = deriveCurrentEmotionalSignal(message);
  return [
    'Live2D 陪伴连续性规则：',
    '- 只把已确认长期记忆当作稳定用户事实；候选、猜测和角色资料都不能冒充用户记忆。',
    '- 关系亲近程度不得因单轮情绪、辱骂或夸奖突然跳变；没有明确证据时保持既有称呼与边界。',
    '- 本轮情绪信号只影响当前回复语气与表现，不写入长期人格或用户画像。',
    signal ? `本轮回应策略（${signal.confidence}）：${MODE_GUIDANCE[signal.mode]}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};
