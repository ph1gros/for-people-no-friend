import type { CharacterEmotion } from '../../core/character/character-reply';
import type {
  VTubeStudioInventory,
  VTubeStudioMappingSource,
  VTubeStudioModelMapping,
  VTubeStudioModelMappingSuggestion,
  VTubeStudioExpressionSummary,
  VTubeStudioHotkeySummary,
} from '../../shared/vtube-studio-ipc';
import { readExpressionSignals, scoreSignalsForEmotion } from './vtube-studio-expression-signals';

/**
 * Model authors name things in whatever language and style they like, so the vocabulary has to
 * cover the languages VTube Studio models actually ship in — English, Chinese, Japanese and
 * Korean — rather than only the ones the bundled model happens to use. Keep the entries as
 * distinctive as possible: every extra generic word raises the chance that two emotions tie on
 * the same expression, and a tie is thrown away rather than guessed.
 */
const EMOTION_HINTS: Readonly<Record<CharacterEmotion, readonly string[]>> = Object.freeze({
  neutral: [],
  happy: [
    'happy',
    'smile',
    'smiling',
    'grin',
    'joy',
    'glad',
    'laugh',
    'love',
    'heart',
    '开心',
    '高兴',
    '快乐',
    '喜悦',
    '笑',
    '微笑',
    '星星眼',
    '爱心',
    '嬉し',
    '笑顔',
    '楽し',
    'にこ',
    'ニコ',
    '喜び',
    'ハート',
    '기쁨',
    '웃음',
    '미소',
    '행복',
  ],
  sad: [
    'sad',
    'unhappy',
    'cry',
    'crying',
    'tear',
    'tears',
    'sorrow',
    'gloom',
    'depressed',
    '难过',
    '伤心',
    '哭',
    '流泪',
    '眼泪',
    '委屈',
    '沮丧',
    '悲し',
    '泣き',
    '涙',
    'しょんぼり',
    '落ち込',
    '슬픔',
    '울음',
    '눈물',
  ],
  angry: [
    'angry',
    'anger',
    'mad',
    'rage',
    'furious',
    'annoyed',
    'pout',
    '生气',
    '愤怒',
    '脸黑',
    '黑脸',
    '恼火',
    '不爽',
    '气鼓鼓',
    '怒り',
    '怒っ',
    'おこ',
    'ぷんぷん',
    'ムッ',
    '不機嫌',
    '화남',
    '분노',
    '짜증',
  ],
  surprised: [
    'surprise',
    'surprised',
    'shock',
    'shocked',
    'astonished',
    'gasp',
    '惊讶',
    '吃惊',
    '震惊',
    '惊呆',
    '目瞪',
    '驚き',
    '驚い',
    'びっくり',
    'ショック',
    'ぽかん',
    '놀람',
    '충격',
  ],
  shy: [
    'shy',
    'blush',
    'blushing',
    'bashful',
    'embarrassed',
    'flustered',
    '害羞',
    '脸红',
    '羞涩',
    '娇羞',
    '腮红',
    '照れ',
    '恥ずかし',
    'てれ',
    '赤面',
    'ほっぺ',
    '부끄',
    '수줍',
    '홍조',
  ],
  playful: [
    'playful',
    'wink',
    'winking',
    'tease',
    'teasing',
    'mischief',
    'smug',
    'tongue',
    '调皮',
    '眨眼',
    '白眼',
    '坏笑',
    '得意',
    '吐舌',
    '俏皮',
    'いたずら',
    'ウィンク',
    'ウインク',
    'てへ',
    'ドヤ',
    'にやり',
    '장난',
    '윙크',
  ],
});

const normalize = (value: string): string =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

const ACTION_HINTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  nod: ['nod', 'agree', 'yes', '点头', '同意', '肯定', 'うなず', '頷', '끄덕'],
  shake: ['shake', 'headshake', 'disagree', '摇头', '不同意', '否定', '首を振', '도리'],
  wave: ['wave', 'waving', 'hello', 'greet', '挥手', '打招呼', '手を振', '인사'],
  dance: ['dance', 'dancing', '跳舞', '舞蹈', 'ダンス', '踊', '춤'],
  jump: ['jump', 'hop', '跳跃', '蹦', 'ジャンプ', '점프'],
  laugh: ['laugh', 'laughing', 'giggle', '大笑', '哈哈', '笑い', '웃기'],
  think: ['think', 'thinking', 'ponder', '思考', '想', '考え', '생각'],
  sleep: ['sleep', 'sleepy', 'doze', '睡觉', '瞌睡', '眠', '잠'],
});

export const resolveExpressionForEmotion = (
  expressions: readonly VTubeStudioExpressionSummary[],
  emotion: CharacterEmotion,
): VTubeStudioExpressionSummary | undefined => {
  const hints = EMOTION_HINTS[emotion];
  if (hints.length === 0) return undefined;
  return expressions.find((expression) => {
    const searchable = normalize(
      `${expression.name} ${expression.file} ${expression.hotkeyNames.join(' ')} ${expression.parameters.map((parameter) => parameter.name).join(' ')}`,
    );
    return hints.some((hint) => searchable.includes(normalize(hint)));
  });
};

export const resolveAnimationHotkeyForAction = (
  hotkeys: readonly VTubeStudioHotkeySummary[],
  action: string,
): VTubeStudioHotkeySummary | undefined => {
  const expected = normalize(action);
  if (!expected) return undefined;
  const hints = ACTION_HINTS[action] ?? [action];
  return hotkeys.find((hotkey) => {
    if (hotkey.type !== 'TriggerAnimation') return false;
    const searchable = normalize(`${hotkey.name} ${hotkey.file}`);
    return hints.some((hint) => searchable.includes(normalize(hint)));
  });
};

export const resolveConfirmedModelMapping = (
  mappings: Readonly<Record<string, VTubeStudioModelMapping>>,
  modelId: string,
): VTubeStudioModelMapping | undefined => mappings[modelId];

export const selectControlledActiveExpressionFiles = (
  expressions: readonly VTubeStudioExpressionSummary[],
  mapping: VTubeStudioModelMapping | undefined,
): string[] => {
  const controlledFiles = new Set(Object.values(mapping?.emotionExpressions ?? {}));
  return expressions
    .filter((expression) => expression.active && controlledFiles.has(expression.file))
    .map((expression) => expression.file);
};

/** A hit's score, plus how specific the winning word was — the tie-breaker, see `rankEmotions`. */
interface Match {
  score: number;
  specificity: number;
}

const scoreText = (value: string, hints: readonly string[], weight: number): Match => {
  const searchable = normalize(value);
  if (!searchable) return { score: 0, specificity: 0 };
  let score = 0;
  let specificity = 0;
  for (const hint of hints) {
    const needle = normalize(hint);
    if (!needle || !searchable.includes(needle)) continue;
    score += weight;
    specificity = Math.max(specificity, needle.length);
  }
  return { score, specificity };
};

const addMatch = (left: Match, right: Match): Match => ({
  score: left.score + right.score,
  specificity: Math.max(left.specificity, right.specificity),
});

const scoreExpressionEmotion = (
  expression: VTubeStudioExpressionSummary,
  linkedHotkeyNames: readonly string[],
  emotion: CharacterEmotion,
): Match => {
  const hints = EMOTION_HINTS[emotion];
  if (hints.length === 0) return { score: 0, specificity: 0 };
  return [
    scoreText([...expression.hotkeyNames, ...linkedHotkeyNames].join(' '), hints, 8),
    scoreText(expression.name, hints, 5),
    scoreText(expression.parameters.map((parameter) => parameter.name).join(' '), hints, 3),
    scoreText(expression.file, hints, 1),
  ].reduce(addMatch);
};

/**
 * Ranks the emotions an expression could stand for, strongest first.
 *
 * Ties are broken by how long the matched word was, because a generic word contained inside a
 * specific one would otherwise deadlock the two emotions that share it: "坏笑" matches both
 * playful (坏笑) and happy (笑), and the longer, more specific word is the one that meant it.
 */
const rankEmotions = (matches: ReadonlyArray<{ emotion: CharacterEmotion; match: Match }>) =>
  [...matches].sort(
    (left, right) =>
      right.match.score - left.match.score || right.match.specificity - left.match.specificity,
  );

const isDecisive = (
  ranked: ReadonlyArray<{ emotion: CharacterEmotion; match: Match }>,
  minimumScore: number,
): boolean => {
  const [strongest, runnerUp] = ranked;
  if (!strongest || strongest.match.score < minimumScore) return false;
  if (!runnerUp) return true;
  // Refuse to guess when two emotions are equally well supported — a wrong mapping is much
  // harder for the user to notice than a missing one.
  return (
    strongest.match.score !== runnerUp.match.score ||
    strongest.match.specificity !== runnerUp.match.specificity
  );
};

interface Candidate {
  file: string;
  score: number;
  source: VTubeStudioMappingSource;
}

/** Tier 1 — what the expression, its file and its hotkeys are *called*. */
const suggestByName = (inventory: VTubeStudioInventory): Map<CharacterEmotion, Candidate> => {
  const best = new Map<CharacterEmotion, Candidate>();
  for (const expression of inventory.expressions) {
    const linkedHotkeyNames = inventory.hotkeys
      .filter((hotkey) => hotkey.type === 'ToggleExpression' && hotkey.file === expression.file)
      .map((hotkey) => hotkey.name);
    const ranked = rankEmotions(
      (Object.keys(EMOTION_HINTS) as CharacterEmotion[]).map((emotion) => ({
        emotion,
        match: scoreExpressionEmotion(expression, linkedHotkeyNames, emotion),
      })),
    );
    if (!isDecisive(ranked, 3)) continue;
    const { emotion, match } = ranked[0];
    const current = best.get(emotion);
    if (!current || match.score > current.score) {
      best.set(emotion, { file: expression.file, score: match.score, source: 'name' });
    }
  }
  return best;
};

/** Tier 2 — what the expression actually *does* to the model's standard parameters. */
const suggestBySignals = (inventory: VTubeStudioInventory): Map<CharacterEmotion, Candidate> => {
  const best = new Map<CharacterEmotion, Candidate>();
  for (const expression of inventory.expressions) {
    const signals = readExpressionSignals(expression, inventory.parameters);
    if (signals.recognizedParameters === 0) continue;
    const scores = scoreSignalsForEmotion(signals);
    const ranked = rankEmotions(
      (Object.keys(EMOTION_HINTS) as CharacterEmotion[]).map((emotion) => ({
        emotion,
        match: { score: scores[emotion] ?? 0, specificity: 0 },
      })),
    );
    if (!isDecisive(ranked, 3)) continue;
    const { emotion, match } = ranked[0];
    const current = best.get(emotion);
    if (!current || match.score > current.score) {
      best.set(emotion, { file: expression.file, score: match.score, source: 'parameters' });
    }
  }
  return best;
};

export const suggestVTubeStudioModelMapping = (
  inventory: VTubeStudioInventory,
): VTubeStudioModelMappingSuggestion => {
  const byName = suggestByName(inventory);
  const bySignals = suggestBySignals(inventory);

  const emotionExpressions: Partial<Record<CharacterEmotion, string>> = {};
  const emotionSources: Partial<Record<CharacterEmotion, VTubeStudioMappingSource>> = {};
  // A name is a statement of intent; parameters are only evidence. Names therefore win outright,
  // and the parameter tier is left to fill the emotions no name spoke for.
  const claimedFiles = new Set<string>();
  for (const [emotion, candidate] of byName) {
    emotionExpressions[emotion] = candidate.file;
    emotionSources[emotion] = candidate.source;
    claimedFiles.add(candidate.file);
  }
  for (const [emotion, candidate] of bySignals) {
    if (emotionExpressions[emotion] || claimedFiles.has(candidate.file)) continue;
    emotionExpressions[emotion] = candidate.file;
    emotionSources[emotion] = candidate.source;
    claimedFiles.add(candidate.file);
  }

  const actionHotkeys: Record<string, string> = {};
  const actionSources: Record<string, VTubeStudioMappingSource> = {};
  for (const action of Object.keys(ACTION_HINTS)) {
    const hotkey = resolveAnimationHotkeyForAction(inventory.hotkeys, action);
    if (!hotkey) continue;
    actionHotkeys[action] = hotkey.hotkeyId;
    actionSources[action] = 'name';
  }

  return {
    emotionExpressions,
    actionHotkeys,
    sources: { emotionExpressions: emotionSources, actionHotkeys: actionSources },
  };
};

export const resolveHotkeyForEmotion = (
  hotkeys: readonly VTubeStudioHotkeySummary[],
  emotion: CharacterEmotion,
): VTubeStudioHotkeySummary | undefined => {
  const hints = EMOTION_HINTS[emotion];
  if (hints.length === 0) return undefined;
  return hotkeys.find((hotkey) => {
    if (hotkey.type !== 'ToggleExpression' && hotkey.type !== 'TriggerAnimation') return false;
    const searchable = normalize(`${hotkey.name} ${hotkey.file}`);
    return hints.some((hint) => searchable.includes(normalize(hint)));
  });
};
