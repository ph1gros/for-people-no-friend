export type OpeningLineContext = 'resume' | 'character-refresh';

export type OpeningLineMode = 'default' | 'contextual';

export const resolveOpeningLineMode = (input: {
  context: OpeningLineContext;
  conversationMessages: number;
}): OpeningLineMode =>
  input.context === 'character-refresh' || input.conversationMessages === 0
    ? 'default'
    : 'contextual';

const LEADING_STAGE_DIRECTION =
  /^(?:\s|\n)*(?:[（(][^）)\n]{1,80}[）)]|[*＊][^*＊\n]{1,80}[*＊])\s*/u;
const MAX_OPENING_LINE_CHARACTERS = 280;

export const sanitizeOpeningLine = (value: string): string | undefined => {
  const withoutStageDirection = value
    .trim()
    .replace(/^```(?:json)?\s*|\s*```$/giu, '')
    .replace(LEADING_STAGE_DIRECTION, '')
    .trim();
  if (!withoutStageDirection) return undefined;
  return Array.from(withoutStageDirection).slice(0, MAX_OPENING_LINE_CHARACTERS).join('');
};
