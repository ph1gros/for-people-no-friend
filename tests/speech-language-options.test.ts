import { describe, expect, it } from 'vitest';

import {
  resolveSpeechLanguage,
  selectSpeechLanguage,
} from '../src/renderer/speech/speech-language-options';

describe('speech language options', () => {
  it.each([
    ['ja-JP', 'ja-JP'],
    ['zh-CN', 'zh-CN'],
    ['en-US', 'en-US'],
  ] as const)('keeps the common language %s as a direct selection', (language, selection) => {
    expect(selectSpeechLanguage(language)).toEqual({ selection, customLanguage: '' });
  });

  it('preserves an existing uncommon language as a custom value', () => {
    expect(selectSpeechLanguage('en-GB')).toEqual({
      selection: 'custom',
      customLanguage: 'en-GB',
    });
  });

  it('resolves direct and custom selections to the saved language code', () => {
    expect(resolveSpeechLanguage('zh-CN', 'ignored')).toBe('zh-CN');
    expect(resolveSpeechLanguage('custom', '  fr-FR  ')).toBe('fr-FR');
  });
});
