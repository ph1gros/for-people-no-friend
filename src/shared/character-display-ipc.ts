export const CHARACTER_DISPLAY_MODES = ['off', 'live2d', 'viewerex', 'vtube-studio'] as const;

export type CharacterDisplayMode = (typeof CHARACTER_DISPLAY_MODES)[number];

export interface SetCharacterDisplayModeInput {
  mode: CharacterDisplayMode;
}

export interface CharacterDisplayModeResult {
  ok: boolean;
  mode: CharacterDisplayMode;
  message?: string;
}

const DISPLAY_MODE_SET = new Set<string>(CHARACTER_DISPLAY_MODES);

export const parseCharacterDisplayMode = (value: unknown): CharacterDisplayMode => {
  if (typeof value !== 'string' || !DISPLAY_MODE_SET.has(value)) {
    throw new Error('The character display mode is invalid.');
  }
  return value as CharacterDisplayMode;
};

export const parseSetCharacterDisplayModeInput = (value: unknown): SetCharacterDisplayModeInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('mode' in value)) {
    throw new Error('The character display mode input is invalid.');
  }
  return { mode: parseCharacterDisplayMode(value.mode) };
};
