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
const TERMINAL_PUNCTUATION = /[。！？!?…~～」』”’）)]$/u;
const INCOMPLETE_TRAILING_PUNCTUATION = /[，,、：:；;—-]$/u;

export const sanitizeOpeningLine = (value: string): string | undefined => {
  const withoutStageDirection = value
    .trim()
    .replace(/^```(?:json)?\s*|\s*```$/giu, '')
    .replace(LEADING_STAGE_DIRECTION, '')
    .trim();
  if (!withoutStageDirection) return undefined;
  const characters = Array.from(withoutStageDirection);
  let bounded = characters.slice(0, MAX_OPENING_LINE_CHARACTERS).join('').trim();
  if (characters.length > MAX_OPENING_LINE_CHARACTERS) {
    const completeEnding = [...bounded.matchAll(/[。！？!?…]/gu)].at(-1);
    if (completeEnding?.index === undefined) return undefined;
    bounded = bounded.slice(0, completeEnding.index + 1);
  }
  if (!bounded || INCOMPLETE_TRAILING_PUNCTUATION.test(bounded)) return undefined;
  if (TERMINAL_PUNCTUATION.test(bounded)) return bounded;
  return `${Array.from(bounded)
    .slice(0, MAX_OPENING_LINE_CHARACTERS - 1)
    .join('')}。`;
};
