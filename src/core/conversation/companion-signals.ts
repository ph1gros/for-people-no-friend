export type EmotionalResponseMode = 'support' | 'celebrate' | 'boundary' | 'reassure';

export interface CurrentEmotionalSignal {
  mode: EmotionalResponseMode;
  confidence: 'explicit' | 'strong-cue';
  matchedCues: string[];
}

export type CompanionMoodEmotion = 'happy' | 'sad' | 'angry' | 'surprised';

export interface RecentCompanionRecord {
  role: 'user' | 'assistant';
  content: string;
}

export interface RecentMoodContinuity {
  emotion: CompanionMoodEmotion;
  mode: EmotionalResponseMode;
  source: 'current' | 'carried';
  contributingRecords: number;
}

export type CompanionReplyEmotion = CompanionMoodEmotion | 'neutral' | 'shy' | 'playful';

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

const MODE_EMOTION: Record<EmotionalResponseMode, CompanionMoodEmotion> = {
  support: 'sad',
  celebrate: 'happy',
  boundary: 'angry',
  reassure: 'surprised',
};

export const deriveRecentMoodContinuity = (
  records: readonly RecentCompanionRecord[],
): RecentMoodContinuity | undefined => {
  const recent = records.slice(-4);
  const scores = new Map<EmotionalResponseMode, { score: number; count: number; latest: number }>();
  let currentMode: EmotionalResponseMode | undefined;
  recent.forEach((record, index) => {
    if (record.role !== 'user') return;
    const signal = deriveCurrentEmotionalSignal(record.content);
    if (!signal) return;
    const previous = scores.get(signal.mode) ?? { score: 0, count: 0, latest: -1 };
    scores.set(signal.mode, {
      score: previous.score + index + 1,
      count: previous.count + 1,
      latest: index,
    });
    if (index === recent.length - 1) currentMode = signal.mode;
  });
  if (scores.size === 0) return undefined;
  const mode =
    currentMode ??
    [...scores.entries()].sort(
      (left, right) => right[1].score - left[1].score || right[1].latest - left[1].latest,
    )[0]?.[0];
  if (!mode) return undefined;
  return {
    mode,
    emotion: MODE_EMOTION[mode],
    source: currentMode === mode ? 'current' : 'carried',
    contributingRecords: scores.get(mode)?.count ?? 1,
  };
};

export const resolveCompanionReplyEmotion = (
  requestedEmotion: CompanionReplyEmotion,
  records: readonly RecentCompanionRecord[],
): CompanionReplyEmotion => {
  const mood = deriveRecentMoodContinuity(records);
  if (!mood) return requestedEmotion;

  // An explicit current cue is the safest source for the visible performance.
  // A carried cue only fills a neutral result, so an older mood cannot override
  // a new non-neutral reply forever.
  if (mood.source === 'current' || requestedEmotion === 'neutral') {
    return mood.emotion;
  }
  return requestedEmotion;
};

export const formatCompanionSignals = (
  message: string,
  recentRecords: readonly RecentCompanionRecord[] = [],
): string => {
  const signal = deriveCurrentEmotionalSignal(message);
  const mood = deriveRecentMoodContinuity(
    recentRecords.length > 0 ? recentRecords : [{ role: 'user', content: message }],
  );
  return [
    'GIF Version 陪伴连续性规则：',
    '- 只把已确认长期记忆当作稳定用户事实；候选、猜测和角色资料都不能冒充用户记忆。',
    '- 关系亲近程度不得因单轮情绪、辱骂或夸奖突然跳变；没有明确证据时保持既有称呼与边界。',
    '- 短期心情只参考最近四条对话记录，越新的线索影响越强；普通中性句不会让上一条明确心情瞬间归零。',
    '- 当前明确情绪可以覆盖旧心情；短期心情不写入长期人格、关系等级或用户画像。',
    mood
      ? `最近四条记录的心情倾向：${mood.emotion}（${mood.source === 'current' ? '本条明确触发' : '由上文延续'}，${mood.contributingRecords} 条同类线索）。回复的 emotion 应保持这种连续性，除非当前语义明确要求改变。`
      : '最近四条记录没有足够明确的心情线索，不强行贴标签。',
    signal ? `本轮回应策略（${signal.confidence}）：${MODE_GUIDANCE[signal.mode]}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};
