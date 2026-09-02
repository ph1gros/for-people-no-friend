export const SPEECH_LANGUAGE_OPTIONS = [
  ['ja-JP', '日语（ja-JP）'],
  ['zh-CN', '中文（zh-CN）'],
  ['en-US', '英语（en-US）'],
  ['custom', '自定义'],
] as const;

export type SpeechLanguageSelection = (typeof SPEECH_LANGUAGE_OPTIONS)[number][0];

const commonSpeechLanguages = new Set<SpeechLanguageSelection>(['ja-JP', 'zh-CN', 'en-US']);

export const selectSpeechLanguage = (
  language: string,
): { selection: SpeechLanguageSelection; customLanguage: string } => {
  const normalizedLanguage = language.trim();
  if (commonSpeechLanguages.has(normalizedLanguage as SpeechLanguageSelection)) {
    return {
      selection: normalizedLanguage as SpeechLanguageSelection,
      customLanguage: '',
    };
  }
  return { selection: 'custom', customLanguage: normalizedLanguage };
};

export const resolveSpeechLanguage = (
  selection: SpeechLanguageSelection,
  customLanguage: string,
): string => (selection === 'custom' ? customLanguage.trim() : selection);
