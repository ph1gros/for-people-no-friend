import type {
  CharacterDisplayMode,
  CharacterDisplayModeResult,
} from '../../shared/character-display-ipc';

interface CharacterDisplayTransitionOptions {
  currentMode: CharacterDisplayMode;
  targetMode: CharacterDisplayMode;
  applyLocalMode(mode: CharacterDisplayMode): void;
  persistMode(mode: CharacterDisplayMode): Promise<CharacterDisplayModeResult>;
}

export const transitionCharacterDisplayMode = async ({
  currentMode,
  targetMode,
  applyLocalMode,
  persistMode,
}: CharacterDisplayTransitionOptions): Promise<CharacterDisplayModeResult> => {
  if (currentMode === targetMode) return persistMode(targetMode);

  if (currentMode !== 'off') applyLocalMode('off');
  try {
    const result = await persistMode(targetMode);
    applyLocalMode(result.ok ? result.mode : currentMode);
    return result;
  } catch (error) {
    if (currentMode !== 'off') applyLocalMode(currentMode);
    throw error;
  }
};
