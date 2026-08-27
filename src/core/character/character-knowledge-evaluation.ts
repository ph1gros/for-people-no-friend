import {
  retrieveCharacterKnowledge,
  type CharacterKnowledgeKind,
  type CharacterKnowledgeRecord,
  type SemanticCharacterKnowledgeRetriever,
} from './character-knowledge';

export interface CharacterKnowledgeEvaluationCase {
  id: string;
  query: string;
  expectedKind: CharacterKnowledgeKind;
  expectedText: string;
}

export interface CharacterKnowledgeEvaluationResult {
  total: number;
  hits: number;
  hitRate: number;
  misses: string[];
  averageReturnedRecords: number;
}

export const evaluateCharacterKnowledgeRetrieval = async (
  characterNamespace: string,
  records: readonly CharacterKnowledgeRecord[],
  cases: readonly CharacterKnowledgeEvaluationCase[],
  semanticRetriever?: SemanticCharacterKnowledgeRetriever,
): Promise<CharacterKnowledgeEvaluationResult> => {
  if (cases.length === 0 || cases.length > 200) {
    throw new Error('The character knowledge evaluation cases are invalid.');
  }
  let hits = 0;
  let returnedRecords = 0;
  const misses: string[] = [];
  for (const evaluation of cases) {
    if (
      !/^[A-Za-z0-9_-]{1,100}$/u.test(evaluation.id) ||
      !evaluation.query.trim() ||
      evaluation.query.length > 4_000 ||
      !evaluation.expectedText.trim() ||
      evaluation.expectedText.length > 1_000
    ) {
      throw new Error('The character knowledge evaluation case is invalid.');
    }
    const matches = await retrieveCharacterKnowledge(
      { characterNamespace, query: evaluation.query },
      records,
      semanticRetriever,
    );
    returnedRecords += matches.length;
    const hit = matches.some(
      ({ record }) =>
        record.kind === evaluation.expectedKind &&
        record.content.normalize('NFKC').includes(evaluation.expectedText.normalize('NFKC')),
    );
    if (hit) hits += 1;
    else misses.push(evaluation.id);
  }
  return {
    total: cases.length,
    hits,
    hitRate: hits / cases.length,
    misses,
    averageReturnedRecords: returnedRecords / cases.length,
  };
};
