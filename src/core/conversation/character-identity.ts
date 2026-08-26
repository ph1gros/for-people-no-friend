const FALLBACK_CHARACTER_NAME = '桌宠';

export const resolveCharacterDisplayName = (profileName?: string, live2dName?: string): string => {
  const configuredName = profileName?.trim();
  if (configuredName && configuredName !== FALLBACK_CHARACTER_NAME) {
    return configuredName;
  }
  return live2dName?.trim() || configuredName || FALLBACK_CHARACTER_NAME;
};
