import { describe, expect, it } from 'vitest';

import {
  adaptLegacyCharacterLore,
  retrieveCharacterKnowledge,
} from '../src/core/character/character-knowledge';
import { evaluateCharacterKnowledgeRetrieval } from '../src/core/character/character-knowledge-evaluation';
import { IRENA_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';

const knowledge = adaptLegacyCharacterLore(
  IRENA_CHARACTER_PROFILE.memoryNamespace,
  IRENA_CHARACTER_PROFILE.lore!,
);

const cases = [
  {
    name: '角色身份',
    query: '你是什么身份，为什么叫灰之魔女？',
    expectedKind: 'identity',
    expectedText: '灰之魔女',
  },
  {
    name: '人物关系',
    query: '你和芙兰是什么关系？',
    expectedKind: 'relationship',
    expectedText: '芙兰',
  },
  {
    name: '说话方式',
    query: '你平时说话是什么语气？',
    expectedKind: 'speech-rule',
    expectedText: '礼貌',
  },
  {
    name: '低落安慰',
    query: '我今天失败了，很难过。',
    expectedKind: 'scenario',
    expectedText: '别担心',
  },
  {
    name: '恶意辱骂',
    query: '你就是个大傻逼。',
    expectedKind: 'scenario',
    expectedText: '没兴趣接受无意义的侮辱',
  },
] as const;

describe('V1.2 fixed roleplay retrieval evaluation', () => {
  it('measures the current keyword baseline before optional indexes are considered', async () => {
    const result = await evaluateCharacterKnowledgeRetrieval(
      IRENA_CHARACTER_PROFILE.memoryNamespace,
      knowledge.records,
      cases.map((evaluation, index) => ({
        id: `case-${index + 1}`,
        query: evaluation.query,
        expectedKind: evaluation.expectedKind,
        expectedText: evaluation.expectedText,
      })),
    );
    expect(result).toEqual({
      total: 5,
      hits: 5,
      hitRate: 1,
      misses: [],
      averageReturnedRecords: expect.any(Number),
    });
    expect(result.averageReturnedRecords).toBeLessThanOrEqual(4);
  });

  it('keeps the same baseline when an optional semantic index is unavailable', async () => {
    const evaluationCases = cases.map((evaluation, index) => ({
      id: `fallback-${index + 1}`,
      query: evaluation.query,
      expectedKind: evaluation.expectedKind,
      expectedText: evaluation.expectedText,
    }));
    const keyword = await evaluateCharacterKnowledgeRetrieval(
      IRENA_CHARACTER_PROFILE.memoryNamespace,
      knowledge.records,
      evaluationCases,
    );
    const fallback = await evaluateCharacterKnowledgeRetrieval(
      IRENA_CHARACTER_PROFILE.memoryNamespace,
      knowledge.records,
      evaluationCases,
      { retrieve: async () => Promise.reject(new Error('fake optional index failure')) },
    );
    expect(fallback).toEqual(keyword);
  });

  for (const evaluation of cases) {
    it(`retrieves evidence for ${evaluation.name}`, async () => {
      const matches = await retrieveCharacterKnowledge(
        {
          characterNamespace: IRENA_CHARACTER_PROFILE.memoryNamespace,
          query: evaluation.query,
        },
        knowledge.records,
      );
      expect(matches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            record: expect.objectContaining({
              kind: evaluation.expectedKind,
              content: expect.stringContaining(evaluation.expectedText),
            }),
          }),
        ]),
      );
      expect(matches.every(({ record }) => record.characterNamespace === 'character-irena')).toBe(
        true,
      );
    });
  }
});
