import type {
  CharacterResearchCandidate,
  CharacterResearchDraft,
} from '../core/character/character-research';

export interface SearchCharactersInput {
  requestId: string;
  name: string;
  sourceWork: string;
}

export interface BuildCharacterDraftInput {
  requestId: string;
  candidateId: string;
}

export interface CancelCharacterResearchInput {
  requestId: string;
}

export type CharacterSearchResult =
  { ok: true; candidates: CharacterResearchCandidate[] } | { ok: false; message: string };

export type CharacterDraftResult =
  { ok: true; draft: CharacterResearchDraft } | { ok: false; message: string };

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const CANDIDATE_ID_PATTERN = /^candidate_[A-Za-z0-9_-]{8,80}$/;

const readString = (
  record: Record<string, unknown>,
  key: string,
  maximum: number,
  allowEmpty = false,
): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) {
    throw new Error(`The character research field ${key} is invalid.`);
  }
  return value.trim();
};

const readRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The character research input is invalid.');
  }
  return value as Record<string, unknown>;
};

const readRequestId = (record: Record<string, unknown>): string => {
  const requestId = readString(record, 'requestId', 100);
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error('The character research request ID is invalid.');
  }
  return requestId;
};

export const parseSearchCharactersInput = (value: unknown): SearchCharactersInput => {
  const record = readRecord(value);
  return {
    requestId: readRequestId(record),
    name: readString(record, 'name', 120),
    sourceWork: readString(record, 'sourceWork', 300, true),
  };
};

export const parseBuildCharacterDraftInput = (value: unknown): BuildCharacterDraftInput => {
  const record = readRecord(value);
  const candidateId = readString(record, 'candidateId', 100);
  if (!CANDIDATE_ID_PATTERN.test(candidateId)) {
    throw new Error('The character research candidate ID is invalid.');
  }
  return { requestId: readRequestId(record), candidateId };
};

export const parseCancelCharacterResearchInput = (value: unknown): CancelCharacterResearchInput => {
  const record = readRecord(value);
  return { requestId: readRequestId(record) };
};
