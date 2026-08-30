import { describe, expect, it } from 'vitest';

import { resolveOpeningLineMode, sanitizeOpeningLine } from '../src/core/conversation/opening-line';

describe('opening line continuity', () => {
  it('uses the default line for a new character and context for a returning character', () => {
    expect(
      resolveOpeningLineMode({
        context: 'resume',
        conversationMessages: 0,
      }),
    ).toBe('default');
    expect(
      resolveOpeningLineMode({
        context: 'resume',
        conversationMessages: 2,
      }),
    ).toBe('contextual');
  });

  it('keeps the requested opening line after creating, switching, or updating a character', () => {
    expect(
      resolveOpeningLineMode({
        context: 'character-refresh',
        conversationMessages: 10,
      }),
    ).toBe('default');
  });

  it('removes a leading stage direction and bounds model output', () => {
    expect(sanitizeOpeningLine('（稍稍点头）上次的事情，我还记得。')).toBe(
      '上次的事情，我还记得。',
    );
    expect(sanitizeOpeningLine('这句话完整但没有句号')).toBe('这句话完整但没有句号。');
    expect(sanitizeOpeningLine(`*挥手* ${'好'.repeat(400)}`)).toBeUndefined();
    expect(sanitizeOpeningLine(`${'好'.repeat(260)}。${'再'.repeat(80)}`)?.endsWith('。')).toBe(
      true,
    );
    expect(sanitizeOpeningLine('这句话还没有说完，')).toBeUndefined();
    expect(sanitizeOpeningLine('（只是看着你）')).toBeUndefined();
    expect(sanitizeOpeningLine('……また来たか。今日はどうしたの？')).toBeUndefined();
  });
});
