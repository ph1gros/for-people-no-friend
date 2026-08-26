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
  warnings: string[];
}
