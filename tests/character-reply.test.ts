import { describe, expect, it } from 'vitest';

import {
  CharacterReplyStreamDecoder,
  parseCharacterReply,
} from '../src/core/character/character-reply';

describe('character reply parsing', () => {
  it('streams only the visible text field and validates emotion and action', () => {
    const decoder = new CharacterReplyStreamDecoder();
    const deltas = ['{"text":"你', '好\\n今天很开心",', '"emotion":"happy","action":"wave"}'].map(
      (part) => decoder.push(part),
    );
    const result = decoder.finish(['wave']);

    expect(deltas.join('')).toBe('你好\n今天很开心');
    expect(result.remainingText).toBe('');
    expect(result.reply).toEqual({
      text: '你好\n今天很开心',
      emotion: 'happy',
      action: 'wave',
    });
  });

  it('keeps plain text and falls back to neutral for malformed output', () => {
    const decoder = new CharacterReplyStreamDecoder();
    expect(decoder.push('普通回复')).toBe('普通回复');
    expect(decoder.push('继续')).toBe('继续');
    expect(decoder.finish().reply).toEqual({ text: '普通回复继续', emotion: 'neutral' });
  });

  it('drops unknown emotions and actions without losing the reply', () => {
    expect(
      parseCharacterReply('{"text":"安全正文","emotion":"wild","action":"missing"}', ['wave']),
    ).toEqual({ text: '安全正文', emotion: 'neutral' });
  });
});
