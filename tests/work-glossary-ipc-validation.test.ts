import { describe, expect, it } from 'vitest';

import { parseWorkGlossaryInput } from '../src/shared/work-glossary-ipc';

describe('work glossary IPC validation', () => {
  it('accepts a bounded source work name', () => {
    expect(parseWorkGlossaryInput({ sourceWork: ' 明日方舟 ' })).toEqual({
      sourceWork: '明日方舟',
    });
  });

  it('rejects missing, empty and oversized work names', () => {
    expect(() => parseWorkGlossaryInput({})).toThrow();
    expect(() => parseWorkGlossaryInput({ sourceWork: ' ' })).toThrow();
    expect(() => parseWorkGlossaryInput({ sourceWork: 'a'.repeat(301) })).toThrow();
  });
});
