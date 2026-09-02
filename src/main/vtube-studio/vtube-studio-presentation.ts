import type { CharacterEmotion } from '../../core/character/character-reply';
import type {
  VTubeStudioInventory,
  VTubeStudioModelMapping,
  VTubeStudioModelMappingSuggestion,
  VTubeStudioExpressionSummary,
  VTubeStudioHotkeySummary,
} from '../../shared/vtube-studio-ipc';

const EMOTION_HINTS: Readonly<Record<CharacterEmotion, readonly string[]>> = Object.freeze({
  neutral: [],
  happy: ['happy', 'smile', 'heart', 'love', '开心', '高兴', '笑', '星星眼', '爱心'],
  sad: ['sad', 'cry', 'tear', '难过', '伤心', '哭', '流泪', '眼泪'],
  angry: ['angry', 'mad', '生气', '愤怒', '脸黑', '黑脸'],
  surprised: ['surprise', 'surprised', 'shock', '惊讶', '吃惊', '震惊'],
  shy: ['shy', 'blush', '害羞', '脸红'],
  playful: ['playful', 'wink', '调皮', '眨眼', '白眼'],
});

const normalize = (value: string): string =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

const ACTION_HINTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  nod: ['nod', 'agree', '点头', '同意', '肯定'],
  shake: ['shake', 'headshake', 'disagree', '摇头', '不同意', '否定'],
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

const scoreText = (value: string, hints: readonly string[], weight: number): number => {
  const searchable = normalize(value);
  if (!searchable) return 0;
  return hints.reduce(
    (score, hint) => (searchable.includes(normalize(hint)) ? score + weight : score),
    0,
  );
};

const scoreExpressionEmotion = (
  expression: VTubeStudioExpressionSummary,
  linkedHotkeyNames: readonly string[],
  emotion: CharacterEmotion,
): number => {
  const hints = EMOTION_HINTS[emotion];
  if (hints.length === 0) return 0;
  return (
    scoreText([...expression.hotkeyNames, ...linkedHotkeyNames].join(' '), hints, 8) +
    scoreText(expression.name, hints, 5) +
    scoreText(expression.parameters.map((parameter) => parameter.name).join(' '), hints, 3) +
    scoreText(expression.file, hints, 1)
  );
};

const suggestEmotionExpressions = (
  inventory: VTubeStudioInventory,
): Partial<Record<CharacterEmotion, string>> => {
  const bestByEmotion = new Map<CharacterEmotion, { file: string; score: number }>();
  for (const expression of inventory.expressions) {
    const linkedHotkeyNames = inventory.hotkeys
      .filter((hotkey) => hotkey.type === 'ToggleExpression' && hotkey.file === expression.file)
      .map((hotkey) => hotkey.name);
    const ranked = (Object.keys(EMOTION_HINTS) as CharacterEmotion[])
      .map((emotion) => ({
        emotion,
        score: scoreExpressionEmotion(expression, linkedHotkeyNames, emotion),
      }))
      .filter(({ score }) => score >= 3)
      .sort((left, right) => right.score - left.score);
    const strongest = ranked[0];
    if (!strongest || strongest.score === ranked[1]?.score) continue;
    const current = bestByEmotion.get(strongest.emotion);
    if (!current || strongest.score > current.score) {
      bestByEmotion.set(strongest.emotion, { file: expression.file, score: strongest.score });
    }
  }
  return Object.fromEntries(
    [...bestByEmotion.entries()].map(([emotion, candidate]) => [emotion, candidate.file]),
  );
};

export const suggestVTubeStudioModelMapping = (
  inventory: VTubeStudioInventory,
): VTubeStudioModelMappingSuggestion => {
  const emotionExpressions = suggestEmotionExpressions(inventory);
  const actionHotkeys: Record<string, string> = {};
  for (const action of Object.keys(ACTION_HINTS)) {
    const hotkey = resolveAnimationHotkeyForAction(inventory.hotkeys, action);
    if (hotkey) actionHotkeys[action] = hotkey.hotkeyId;
  }
  return { emotionExpressions, actionHotkeys };
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
