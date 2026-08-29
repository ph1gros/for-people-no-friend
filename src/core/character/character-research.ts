import type { CharacterLore } from './character-lore';

export interface CharacterResearchCandidate {
  id: string;
  name: string;
  sourceWork: string;
  description: string;
  sourceName: string;
  sourceUrl: string;
  matchReason: string;
}

export interface CharacterResearchDraft {
  lore: CharacterLore;
  profileFields: {
    userDisplayName: string;
    bio: string;
    personaPrompt: string;
  };
  warnings: string[];
}

export const resolveAutomaticGlossarySourceWork = (
  providedSourceWork: string,
  candidates: readonly CharacterResearchCandidate[],
): string | undefined => {
  const provided = providedSourceWork.normalize('NFKC').trim();
  if (provided) return provided;

  const works = new Map<string, string>();
  for (const candidate of candidates) {
    const sourceWork = candidate.sourceWork.normalize('NFKC').trim();
    if (!sourceWork) continue;
    works.set(sourceWork.toLocaleLowerCase(), sourceWork);
  }
  return works.size === 1 ? works.values().next().value : undefined;
};
