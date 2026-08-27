import { describe, expect, it } from 'vitest';

import { parseCharacterLoreOutput } from '../src/main/llm/model-runtime';

describe('character lore model output parsing', () => {
  it('accepts a complete JSON object even when the provider reports the token limit', () => {
    expect(
      parseCharacterLoreOutput(
        '```json\n{"identity":"枫丹前任水神","sampleLines":[]}\n```',
        'fake',
        'max_tokens',
      ),
    ).toMatchObject({ identity: '枫丹前任水神', sampleLines: [] });
  });

  it('repairs only trailing JSON commas and rejects genuinely truncated output', () => {
    expect(
      parseCharacterLoreOutput('{"identity":"芙宁娜", "relationships": [],}', 'fake'),
    ).toMatchObject({ identity: '芙宁娜', relationships: [] });
    expect(() =>
      parseCharacterLoreOutput('{"identity":"芙宁娜", "relationships": [', 'fake', 'max_tokens'),
    ).toThrow('invalid or unsuccessful response');
  });
});
