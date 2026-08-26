import { describe, expect, it } from 'vitest';

import {
  parseBuildCharacterDraftInput,
  parseCancelCharacterResearchInput,
  parseSearchCharactersInput,
} from '../src/shared/character-research-ipc';

describe('M5.1 character research IPC validation', () => {
  it('accepts bounded search, draft and cancellation inputs', () => {
    expect(
      parseSearchCharactersInput({
        requestId: 'character_search_123',
        name: 'Mon3tr',
        sourceWork: '明日方舟',
      }),
    ).toEqual({ requestId: 'character_search_123', name: 'Mon3tr', sourceWork: '明日方舟' });
    expect(
      parseBuildCharacterDraftInput({
        requestId: 'character_draft_123',
        candidateId: 'candidate_12345678',
      }),
    ).toEqual({ requestId: 'character_draft_123', candidateId: 'candidate_12345678' });
    expect(parseCancelCharacterResearchInput({ requestId: 'character_search_123' })).toEqual({
      requestId: 'character_search_123',
    });
  });

  it('rejects unbounded strings and candidate URLs', () => {
    expect(() =>
      parseSearchCharactersInput({ requestId: '../bad', name: 'Mon3tr', sourceWork: '' }),
    ).toThrow();
    expect(() =>
      parseSearchCharactersInput({ requestId: 'search_1', name: 'x'.repeat(121), sourceWork: '' }),
    ).toThrow();
    expect(() =>
      parseBuildCharacterDraftInput({
        requestId: 'draft_1',
        candidateId: 'https://attacker.example/page',
      }),
    ).toThrow();
  });
});
