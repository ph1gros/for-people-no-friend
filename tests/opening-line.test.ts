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
    expect(sanitizeOpeningLine(`*挥手* ${'好'.repeat(400)}`)?.length).toBe(280);
    expect(sanitizeOpeningLine('（只是看着你）')).toBeUndefined();
  });
});
