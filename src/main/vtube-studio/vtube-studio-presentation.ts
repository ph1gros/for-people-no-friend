import type { CharacterEmotion } from '../../core/character/character-reply';
import type {
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
  playful: ['playful', 'wink', '调皮', '眨眼'],
});

const normalize = (value: string): string =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

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
  return hotkeys.find((hotkey) => {
    if (hotkey.type !== 'TriggerAnimation') return false;
    const searchable = normalize(`${hotkey.name} ${hotkey.file}`);
    return searchable.includes(expected);
  });
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
