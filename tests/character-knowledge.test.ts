import { describe, expect, it } from 'vitest';

import {
  adaptLegacyCharacterLore,
  CHARACTER_KNOWLEDGE_SCHEMA_VERSION,
  createCharacterLoreRevision,
  formatCharacterKnowledgeContext,
  retrieveCharacterKnowledge,
  retrieveCharacterKnowledgeForPrompt,
  type CharacterKnowledgeRecord,
  validateCharacterKnowledgeRecord,
} from '../src/core/character/character-knowledge';
import { IRENA_CHARACTER_PROFILE } from '../src/core/conversation/character-profile';

const record = (
  id: string,
  characterNamespace: string,
  content: string,
  keywords: string[],
): CharacterKnowledgeRecord => ({
  schemaVersion: CHARACTER_KNOWLEDGE_SCHEMA_VERSION,
  id,
  characterNamespace,
  kind: 'relationship',
  title: '人物关系',
  content,
  keywords,
  importance: 0.8,
  evidence: [{ sourceId: 'source_1', fieldPath: 'relationships[0]', basis: 'direct' }],
});

describe('V1.2 character knowledge retrieval', () => {
  it('rejects malformed records and evidence before future storage can trust them', () => {
    expect(() => validateCharacterKnowledgeRecord(null)).toThrow('invalid');
    expect(() =>
      validateCharacterKnowledgeRecord({
        ...record('bad-evidence', 'character-alpha', '正文', ['关键词']),
        evidence: [null],
      }),
    ).toThrow('invalid');
  });

  it('adapts the old card without pretending aggregate sources are field-level proof', () => {
    const knowledge = adaptLegacyCharacterLore(
      IRENA_CHARACTER_PROFILE.memoryNamespace,
      IRENA_CHARACTER_PROFILE.lore!,
    );
    expect(knowledge.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'identity', characterNamespace: 'character-irena' }),
        expect.objectContaining({ kind: 'relationship' }),
        expect.objectContaining({ kind: 'scenario' }),
        expect.objectContaining({ kind: 'speech-rule' }),
      ]),
    );
    expect(knowledge.profileRevision).toBe(
      createCharacterLoreRevision(IRENA_CHARACTER_PROFILE.lore!),
    );
    expect(knowledge.records.find(({ kind }) => kind === 'identity')?.evidence[0]).toMatchObject({
      fieldPath: 'lore.identity',
      basis: 'legacy-aggregate',
    });
    expect(knowledge.records.find(({ kind }) => kind === 'scenario')?.evidence[0]).toMatchObject({
      fieldPath: 'lore.roleplayExamples[0]',
      basis: 'synthesized',
    });
  });

  it('keeps retrieval inside the requested character namespace', async () => {
    const matches = await retrieveCharacterKnowledge(
      { characterNamespace: 'character-alpha', query: '甲和你是什么关系？' },
      [
        record('alpha-one', 'character-alpha', '甲是重要同伴。', ['甲', '关系']),
        record('other-irena', 'character-other', '不应泄漏的另一角色资料。', ['凯尔希', '关系']),
      ],
    );
    expect(matches.map(({ record: item }) => item.id)).toEqual(['alpha-one']);
  });

  it('uses deterministic keyword-first ordering and enforces prompt budgets', async () => {
    const matches = await retrieveCharacterKnowledge(
      {
        characterNamespace: 'character-alpha',
        query: '博士和阿米娅是什么关系？',
        maximumRecords: 2,
        maximumCharacters: 200,
      },
      [
        record('amiya', 'character-alpha', '阿米娅是希望保护的重要同伴。', ['阿米娅', '关系']),
        record('doctor', 'character-alpha', '博士是信任的同行者。', ['博士', '关系']),
        record('third', 'character-alpha', '另一条也提到关系但不应超过数量。', ['关系']),
      ],
    );
    expect(matches).toHaveLength(2);
    expect(matches[0]?.record.id).toBe('amiya');
    expect(matches.every(({ matchReasons }) => matchReasons.length > 0)).toBe(true);
    expect(
      matches.reduce((total, match) => total + match.record.content.length, 0),
    ).toBeLessThanOrEqual(200);
  });

  it('skips a single oversized record instead of breaking the character budget', async () => {
    const matches = await retrieveCharacterKnowledge(
      { characterNamespace: 'character-alpha', query: '甲', maximumCharacters: 200 },
      [record('oversized', 'character-alpha', `甲${'很'.repeat(300)}`, ['甲'])],
    );
    expect(matches).toEqual([]);
  });

  it('falls back to the same keyword result when optional semantic retrieval fails', async () => {
    const records = [
      record('alpha-one', 'character-alpha', '甲是重要同伴。', ['甲', '关系']),
      record('alpha-two', 'character-alpha', '乙是重要同伴。', ['乙', '关系']),
    ];
    const input = { characterNamespace: 'character-alpha', query: '甲是谁？' };
    const keywordOnly = await retrieveCharacterKnowledge(input, records);
    const degraded = await retrieveCharacterKnowledge(input, records, {
      retrieve: async () => {
        throw new Error('fake semantic index unavailable');
      },
    });
    expect(degraded).toEqual(keywordOnly);
  });

  it('rejects semantic results from another namespace and keeps keyword hits first', async () => {
    const records = [
      record('alpha-one', 'character-alpha', '甲是重要同伴。', ['甲']),
      record('alpha-two', 'character-alpha', '乙是重要同伴。', ['乙']),
      record('private-other', 'character-other', '另一角色资料。', ['秘密']),
    ];
    const matches = await retrieveCharacterKnowledge(
      { characterNamespace: 'character-alpha', query: '甲是谁？' },
      records,
      {
        retrieve: async () => [
          { recordId: 'private-other', score: 1 },
          { recordId: 'alpha-two', score: 0.9 },
        ],
      },
    );
    expect(matches.map(({ record: item }) => item.id)).toEqual(['alpha-one', 'alpha-two']);
    expect(matches[1]?.matchReasons).toContain('可选语义补充');
  });

  it('formats source pointers without mixing in user-memory wording', async () => {
    const matches = await retrieveCharacterKnowledge(
      { characterNamespace: 'character-alpha', query: '甲' },
      [record('alpha-one', 'character-alpha', '甲是重要同伴。', ['甲'])],
    );
    const context = formatCharacterKnowledgeContext(matches);
    expect(context).toContain('不是用户长期记忆');
    expect(context).toContain('relationships[0]');
    expect(context).toContain('source_1');
  });

  it('keeps identity and speech rules while adding only a few relevant records', async () => {
    const base = adaptLegacyCharacterLore(
      IRENA_CHARACTER_PROFILE.memoryNamespace,
      IRENA_CHARACTER_PROFILE.lore!,
    );
    const matches = await retrieveCharacterKnowledgeForPrompt(
      {
        characterNamespace: IRENA_CHARACTER_PROFILE.memoryNamespace,
        query: '我今天失败了，有点难过。',
      },
      base.records,
    );

    expect(matches).toHaveLength(4);
    expect(matches.map(({ record: item }) => item.kind)).toEqual(
      expect.arrayContaining(['identity', 'speech-rule', 'scenario']),
    );
    expect(matches.some(({ record: item }) => item.content.includes('别担心'))).toBe(true);
    expect(matches.every(({ record: item }) => item.characterNamespace === 'character-irena')).toBe(
      true,
    );
  });

  it('bounds prompt retrieval even when a future caller requests excessive output', async () => {
    const base = adaptLegacyCharacterLore(
      IRENA_CHARACTER_PROFILE.memoryNamespace,
      IRENA_CHARACTER_PROFILE.lore!,
    );
    const matches = await retrieveCharacterKnowledgeForPrompt(
      {
        characterNamespace: IRENA_CHARACTER_PROFILE.memoryNamespace,
        query: '伊雷娜、芙兰和沙耶分别是什么关系？',
        maximumRecords: 999,
        maximumCharacters: 999_999,
      },
      base.records,
    );

    expect(matches.length).toBeLessThanOrEqual(8);
    expect(
      matches.reduce((sum, match) => sum + match.record.content.length, 0),
    ).toBeLessThanOrEqual(8_000);
  });
});
