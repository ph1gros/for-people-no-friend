import type { CharacterEmotion } from '../../core/character/character-reply';
import type { CharacterPresentationState } from '../../core/presentation/character-presentation';
import {
  DEFAULT_VIEWEREX_SETTINGS,
  parseViewerExSettings,
  type ViewerExSettings,
} from '../../shared/viewerex-ipc';

export interface ViewerExMappingDraft {
  stateMotions: string;
  emotionExpressions: string;
  actionMotions: string;
}

export type ViewerExMappings = Pick<
  ViewerExSettings,
  'stateMotions' | 'emotionExpressions' | 'actionMotions'
>;

const parseLines = (value: string): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf('=');
    if (separator <= 0 || separator === line.length - 1) {
      throw new Error('每行映射必须使用“名称=编号或动作组”。');
    }
    const key = line.slice(0, separator).trim();
    const mappedValue = line.slice(separator + 1).trim();
    if (key in result) throw new Error(`映射“${key}”重复。`);
    result[key] = mappedValue;
  }
  return result;
};

export const parseViewerExMappingDraft = (draft: ViewerExMappingDraft): ViewerExMappings => {
  const rawExpressions = parseLines(draft.emotionExpressions);
  const parsed = parseViewerExSettings({
    ...DEFAULT_VIEWEREX_SETTINGS,
    stateMotions: parseLines(draft.stateMotions),
    emotionExpressions: Object.fromEntries(
      Object.entries(rawExpressions).map(([emotion, expressionId]) => [
        emotion,
        Number(expressionId),
      ]),
    ),
    actionMotions: parseLines(draft.actionMotions),
  });
  return {
    stateMotions: parsed.stateMotions as Partial<Record<CharacterPresentationState, string>>,
    emotionExpressions: parsed.emotionExpressions as Partial<Record<CharacterEmotion, number>>,
    actionMotions: parsed.actionMotions,
  };
};

export const formatViewerExMappingDraft = (
  mapping: Record<string, string | number | undefined>,
): string =>
  Object.entries(mapping)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
