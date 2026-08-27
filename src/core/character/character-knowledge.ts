import type { CharacterLore, CharacterLoreSource } from './character-lore';

export const CHARACTER_KNOWLEDGE_SCHEMA_VERSION = 1 as const;

export type CharacterKnowledgeKind =
  'identity' | 'trait' | 'event' | 'relationship' | 'scenario' | 'speech-rule' | 'example-line';

export type CharacterKnowledgeEvidenceBasis = 'direct' | 'synthesized' | 'legacy-aggregate';

export interface CharacterKnowledgeEvidence {
  sourceId: string;
  fieldPath: string;
  basis: CharacterKnowledgeEvidenceBasis;
}

export interface CharacterKnowledgeRecord {
  schemaVersion: typeof CHARACTER_KNOWLEDGE_SCHEMA_VERSION;
  id: string;
  characterNamespace: string;
  kind: CharacterKnowledgeKind;
  title: string;
  content: string;
  keywords: string[];
  importance: number;
  evidence: CharacterKnowledgeEvidence[];
}

export interface CharacterKnowledgeBase {
  schemaVersion: typeof CHARACTER_KNOWLEDGE_SCHEMA_VERSION;
  characterNamespace: string;
  profileRevision: string;
  sourceWork: string;
  sources: CharacterLoreSource[];
  records: CharacterKnowledgeRecord[];
}

export interface CharacterKnowledgeMatch {
  record: CharacterKnowledgeRecord;
  keywordScore: number;
  semanticScore?: number;
  matchReasons: string[];
}

export interface CharacterKnowledgeQuery {
  characterNamespace: string;
  query: string;
  maximumRecords?: number;
  maximumCharacters?: number;
}

export interface SemanticCharacterKnowledgeMatch {
  recordId: string;
  score: number;
}

export interface SemanticCharacterKnowledgeRetriever {
  retrieve(
    input: CharacterKnowledgeQuery & { records: readonly CharacterKnowledgeRecord[] },
  ): Promise<readonly SemanticCharacterKnowledgeMatch[]>;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const PROFILE_REVISION_PATTERN = /^lore-v1-[a-f\d]{16}$/;
const FIELD_PATH_PATTERN = /^[A-Za-z](?:[A-Za-z0-9_.-]|\[\d+\])*$/;
const KINDS: readonly CharacterKnowledgeKind[] = [
  'identity',
  'trait',
  'event',
  'relationship',
  'scenario',
  'speech-rule',
  'example-line',
];
const BASES: readonly CharacterKnowledgeEvidenceBasis[] = [
  'direct',
  'synthesized',
  'legacy-aggregate',
];

const QUERY_INTENT_HINTS: ReadonlyArray<[RegExp, string[]]> = [
  [/(难过|伤心|不开心|沮丧|失败|累了|陪陪|安慰)/u, ['难过', '低落', '关心', '安慰']],
  [/(开心|高兴|成功|太好了|庆祝|夸夸)/u, ['开心', '称赞', '鼓励', '进展']],
  [/(傻逼|蠢货|废物|闭嘴|滚开|讨厌你|骂你|侮辱|威胁)/u, ['愤怒', '生气', '不满', '辱骂', '威胁']],
  [/(害怕|危险|救命|保护|受伤|攻击)/u, ['害怕', '危险', '保护', '威胁']],
  [/(帮忙|怎么办|建议|决定|选择|风险)/u, ['帮助', '认真', '判断', '风险']],
  [/(你好|早上好|晚上好|在吗|聊聊)/u, ['日常', '问候', '平静']],
];

const normalize = (value: string): string => value.normalize('NFKC').trim().toLowerCase();

export const validateCharacterKnowledgeNamespace = (value: unknown): string => {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new Error('The character knowledge namespace is invalid.');
  }
  return value;
};

const uniqueStrings = (values: readonly string[]): string[] => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
];

const tokenize = (value: string): Set<string> => {
  const normalized = normalize(value);
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(/[a-z0-9]+|[\u3400-\u9fff]+/gu)) {
    const token = match[0];
    if (/^[a-z0-9]+$/u.test(token)) {
      if (token.length >= 2) tokens.add(token);
      continue;
    }
    if (token.length <= 2) {
      tokens.add(token);
      continue;
    }
    tokens.add(token);
    for (let index = 0; index < token.length - 1; index += 1) {
      tokens.add(token.slice(index, index + 2));
    }
  }
  return tokens;
};

const validateEvidence = (value: unknown): CharacterKnowledgeEvidence => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The character knowledge evidence is invalid.');
  }
  const evidence = value as Partial<CharacterKnowledgeEvidence>;
  if (
    typeof evidence.sourceId !== 'string' ||
    !ID_PATTERN.test(evidence.sourceId) ||
    typeof evidence.fieldPath !== 'string' ||
    evidence.fieldPath.length > 160 ||
    !FIELD_PATH_PATTERN.test(evidence.fieldPath) ||
    typeof evidence.basis !== 'string' ||
    !BASES.includes(evidence.basis as CharacterKnowledgeEvidenceBasis)
  ) {
    throw new Error('The character knowledge evidence is invalid.');
  }
  return {
    sourceId: evidence.sourceId,
    fieldPath: evidence.fieldPath,
    basis: evidence.basis as CharacterKnowledgeEvidenceBasis,
  };
};

export const validateCharacterKnowledgeRecord = (value: unknown): CharacterKnowledgeRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The character knowledge record is invalid.');
  }
  const record = value as Partial<CharacterKnowledgeRecord>;
  if (
    record.schemaVersion !== CHARACTER_KNOWLEDGE_SCHEMA_VERSION ||
    typeof record.id !== 'string' ||
    !ID_PATTERN.test(record.id) ||
    typeof record.characterNamespace !== 'string' ||
    !ID_PATTERN.test(record.characterNamespace) ||
    typeof record.kind !== 'string' ||
    !KINDS.includes(record.kind as CharacterKnowledgeKind) ||
    typeof record.title !== 'string' ||
    !record.title.trim() ||
    record.title.length > 160 ||
    typeof record.content !== 'string' ||
    !record.content.trim() ||
    record.content.length > 4_000 ||
    !Array.isArray(record.keywords) ||
    record.keywords.length > 40 ||
    record.keywords.some(
      (keyword) => typeof keyword !== 'string' || !keyword.trim() || keyword.length > 120,
    ) ||
    typeof record.importance !== 'number' ||
    !Number.isFinite(record.importance) ||
    record.importance < 0 ||
    record.importance > 1 ||
    !Array.isArray(record.evidence) ||
    record.evidence.length > 12
  ) {
    throw new Error('The character knowledge record is invalid.');
  }
  return {
    schemaVersion: CHARACTER_KNOWLEDGE_SCHEMA_VERSION,
    id: record.id,
    characterNamespace: record.characterNamespace,
    kind: record.kind as CharacterKnowledgeKind,
    title: record.title.trim(),
    content: record.content.trim(),
    keywords: uniqueStrings(record.keywords as string[]),
    importance: record.importance,
    evidence: (record.evidence as CharacterKnowledgeEvidence[]).map(validateEvidence),
  };
};

const validateKnowledgeSource = (value: unknown): CharacterLoreSource => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The character knowledge source is invalid.');
  }
  const source = value as Partial<CharacterLoreSource>;
  if (
    typeof source.id !== 'string' ||
    !ID_PATTERN.test(source.id) ||
    typeof source.title !== 'string' ||
    !source.title.trim() ||
    source.title.length > 300 ||
    typeof source.siteName !== 'string' ||
    !source.siteName.trim() ||
    source.siteName.length > 200 ||
    typeof source.url !== 'string' ||
    source.url.length > 2_000 ||
    typeof source.retrievedAt !== 'number' ||
    !Number.isFinite(source.retrievedAt) ||
    source.retrievedAt <= 0
  ) {
    throw new Error('The character knowledge source is invalid.');
  }
  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    throw new Error('The character knowledge source is invalid.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('The character knowledge source is invalid.');
  }
  return {
    id: source.id,
    title: source.title.trim(),
    url: url.toString(),
    siteName: source.siteName.trim(),
    retrievedAt: Math.trunc(source.retrievedAt),
  };
};

export const validateCharacterKnowledgeBase = (value: unknown): CharacterKnowledgeBase => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The character knowledge base is invalid.');
  }
  const base = value as Partial<CharacterKnowledgeBase>;
  const characterNamespace = validateCharacterKnowledgeNamespace(base.characterNamespace);
  if (
    base.schemaVersion !== CHARACTER_KNOWLEDGE_SCHEMA_VERSION ||
    typeof base.profileRevision !== 'string' ||
    !PROFILE_REVISION_PATTERN.test(base.profileRevision) ||
    typeof base.sourceWork !== 'string' ||
    base.sourceWork.length > 300 ||
    !Array.isArray(base.sources) ||
    base.sources.length > 64 ||
    !Array.isArray(base.records) ||
    base.records.length > 2_000
  ) {
    throw new Error('The character knowledge base is invalid.');
  }
  const sources = base.sources.map(validateKnowledgeSource);
  const sourceIds = new Set(sources.map(({ id }) => id));
  if (sourceIds.size !== sources.length) {
    throw new Error('The character knowledge base contains duplicate sources.');
  }
  const records = base.records.map(validateCharacterKnowledgeRecord);
  const recordIds = new Set(records.map(({ id }) => id));
  if (
    recordIds.size !== records.length ||
    records.some(
      (record) =>
        record.characterNamespace !== characterNamespace ||
        record.evidence.some(({ sourceId }) => !sourceIds.has(sourceId)),
    )
  ) {
    throw new Error('The character knowledge base contains invalid references.');
  }
  return {
    schemaVersion: CHARACTER_KNOWLEDGE_SCHEMA_VERSION,
    characterNamespace,
    profileRevision: base.profileRevision,
    sourceWork: base.sourceWork.trim(),
    sources,
    records,
  };
};

export const createCharacterLoreRevision = (lore: CharacterLore): string => {
  const serialized = JSON.stringify([
    lore.canonicalName,
    lore.aliases,
    lore.sourceWork,
    lore.identity,
    lore.personality,
    lore.background,
    lore.relationships,
    lore.speechStyle,
    lore.sampleLines ?? [],
    lore.roleplayExamples ?? [],
    lore.sources,
  ]);
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  const hex = (value: number): string => (value >>> 0).toString(16).padStart(8, '0');
  return `lore-v1-${hex(first)}${hex(second)}`;
};

const aggregateEvidence = (
  sources: readonly CharacterLoreSource[],
  fieldPath: string,
): CharacterKnowledgeEvidence[] =>
  sources.map(({ id }) => ({ sourceId: id, fieldPath, basis: 'legacy-aggregate' }));

const makeRecord = (
  characterNamespace: string,
  id: string,
  kind: CharacterKnowledgeKind,
  title: string,
  content: string,
  keywords: string[],
  importance: number,
  evidence: CharacterKnowledgeEvidence[],
): CharacterKnowledgeRecord =>
  validateCharacterKnowledgeRecord({
    schemaVersion: CHARACTER_KNOWLEDGE_SCHEMA_VERSION,
    id,
    characterNamespace,
    kind,
    title,
    content,
    keywords,
    importance,
    evidence,
  });

export const adaptLegacyCharacterLore = (
  characterNamespace: string,
  lore: CharacterLore,
): CharacterKnowledgeBase => {
  validateCharacterKnowledgeNamespace(characterNamespace);
  const prefix = characterNamespace.replace(/[^A-Za-z0-9_-]/gu, '-');
  const commonKeywords = [lore.canonicalName, ...lore.aliases, lore.sourceWork];
  const records: CharacterKnowledgeRecord[] = [];
  const add = (
    suffix: string,
    kind: CharacterKnowledgeKind,
    title: string,
    content: string,
    fieldPath: string,
    keywords: string[],
    importance: number,
    evidence = aggregateEvidence(lore.sources, fieldPath),
  ): void => {
    if (!content.trim()) return;
    records.push(
      makeRecord(
        characterNamespace,
        `${prefix}-${suffix}`.slice(0, 100),
        kind,
        title,
        content,
        uniqueStrings([...commonKeywords, ...keywords]).slice(0, 40),
        importance,
        evidence,
      ),
    );
  };

  add('identity', 'identity', '身份', lore.identity, 'lore.identity', ['身份', '是谁'], 1);
  add('personality', 'trait', '性格', lore.personality, 'lore.personality', ['性格', '态度'], 0.9);
  add(
    'background',
    'event',
    '经历与背景',
    lore.background,
    'lore.background',
    ['背景', '过去', '经历'],
    0.8,
  );
  add(
    'speech-style',
    'speech-rule',
    '说话方式',
    lore.speechStyle,
    'lore.speechStyle',
    ['说话', '语气', '称呼'],
    1,
  );
  lore.relationships.forEach((relationship, index) =>
    add(
      `relationship-${index + 1}`,
      'relationship',
      '人物关系',
      relationship,
      `lore.relationships[${index}]`,
      ['关系', ...tokenize(relationship)],
      0.85,
    ),
  );
  (lore.roleplayExamples ?? []).forEach((example, index) => {
    const evidence = example.sourceId
      ? [
          {
            sourceId: example.sourceId,
            fieldPath: `lore.roleplayExamples[${index}]`,
            basis: 'synthesized' as const,
          },
        ]
      : [];
    add(
      `scenario-${index + 1}`,
      'scenario',
      example.scene,
      `触发：${example.trigger}\n态度：${example.attitude}\n表达参考：${example.line}`,
      `lore.roleplayExamples[${index}]`,
      [example.scene, example.emotion, example.trigger, example.attitude],
      0.75,
      evidence,
    );
  });
  (lore.sampleLines ?? []).forEach((line, index) =>
    add(
      `example-line-${index + 1}`,
      'example-line',
      '短句参考',
      line,
      `lore.sampleLines[${index}]`,
      [],
      0.4,
    ),
  );

  return validateCharacterKnowledgeBase({
    schemaVersion: CHARACTER_KNOWLEDGE_SCHEMA_VERSION,
    characterNamespace,
    profileRevision: createCharacterLoreRevision(lore),
    sourceWork: lore.sourceWork,
    sources: lore.sources.map((source) => ({ ...source })),
    records,
  });
};

const scoreKeywordMatch = (
  record: CharacterKnowledgeRecord,
  query: string,
  queryTokens: ReadonlySet<string>,
  intentHints: readonly string[],
): { score: number; reasons: string[] } => {
  const normalizedQuery = normalize(query);
  const reasons: string[] = [];
  let score = 0;
  for (const keyword of record.keywords) {
    const normalizedKeyword = normalize(keyword);
    if (!normalizedKeyword) continue;
    if (normalizedQuery.includes(normalizedKeyword)) {
      score += normalizedKeyword.length >= 3 ? 8 : 5;
      reasons.push(`关键词：${keyword}`);
    }
  }
  const recordTokens = tokenize(`${record.title} ${record.content}`);
  const overlapping = [...queryTokens].filter((token) => recordTokens.has(token));
  score += Math.min(12, overlapping.length * 2);
  if (overlapping.length > 0) reasons.push(`文本重合：${overlapping.slice(0, 4).join('、')}`);
  const intentText = normalize(`${record.title} ${record.content} ${record.keywords.join(' ')}`);
  const matchedIntents = intentHints.filter((hint) => intentText.includes(normalize(hint)));
  score += Math.min(12, matchedIntents.length * 4);
  if (matchedIntents.length > 0) {
    reasons.push(`意图：${matchedIntents.slice(0, 3).join('、')}`);
  }
  const kindIntentMatched =
    (record.kind === 'identity' && /(身份|是谁|什么人|职位|负责什么)/u.test(query)) ||
    (record.kind === 'relationship' && /(关系|同伴|朋友|认识|和.+什么)/u.test(query)) ||
    (record.kind === 'speech-rule' && /(称呼|说话|语气|口吻|怎么叫)/u.test(query));
  if (kindIntentMatched) {
    score += 20;
    reasons.push(`资料类型：${record.kind}`);
  }
  return { score, reasons: uniqueStrings(reasons) };
};

const applyBudget = (
  matches: CharacterKnowledgeMatch[],
  maximumRecords: number,
  maximumCharacters: number,
): CharacterKnowledgeMatch[] => {
  const selected: CharacterKnowledgeMatch[] = [];
  let characters = 0;
  for (const match of matches) {
    if (selected.length >= maximumRecords) break;
    if (characters + match.record.content.length > maximumCharacters) {
      continue;
    }
    selected.push(match);
    characters += match.record.content.length;
  }
  return selected;
};

const boundedInteger = (value: number | undefined, fallback: number, maximum: number): number =>
  typeof value === 'number' && Number.isInteger(value)
    ? Math.max(1, Math.min(maximum, value))
    : fallback;

export const retrieveCharacterKnowledge = async (
  input: CharacterKnowledgeQuery,
  records: readonly CharacterKnowledgeRecord[],
  semanticRetriever?: SemanticCharacterKnowledgeRetriever,
): Promise<CharacterKnowledgeMatch[]> => {
  if (
    !ID_PATTERN.test(input.characterNamespace) ||
    !input.query.trim() ||
    input.query.length > 4_000
  ) {
    throw new Error('The character knowledge query is invalid.');
  }
  const maximumRecords = boundedInteger(input.maximumRecords, 4, 8);
  const maximumCharacters = Math.max(200, boundedInteger(input.maximumCharacters, 2_400, 8_000));
  const eligible = records
    .map(validateCharacterKnowledgeRecord)
    .filter((record) => record.characterNamespace === input.characterNamespace);
  const queryTokens = tokenize(input.query);
  const intentHints = QUERY_INTENT_HINTS.flatMap(([pattern, hints]) =>
    pattern.test(input.query) ? hints : [],
  );
  const keywordMatches: CharacterKnowledgeMatch[] = eligible
    .map((record) => {
      const { score, reasons } = scoreKeywordMatch(record, input.query, queryTokens, intentHints);
      return {
        record,
        keywordScore: score,
        matchReasons: reasons,
      } satisfies CharacterKnowledgeMatch;
    })
    .filter(({ keywordScore }) => keywordScore > 0)
    .sort(
      (left, right) =>
        right.keywordScore - left.keywordScore ||
        right.record.importance - left.record.importance ||
        left.record.id.localeCompare(right.record.id),
    );

  if (!semanticRetriever) {
    return applyBudget(keywordMatches, maximumRecords, maximumCharacters);
  }

  let semanticMatches: readonly SemanticCharacterKnowledgeMatch[];
  try {
    const retrieved = await semanticRetriever.retrieve({ ...input, records: eligible });
    semanticMatches = Array.isArray(retrieved) ? retrieved : [];
  } catch {
    return applyBudget(keywordMatches, maximumRecords, maximumCharacters);
  }
  const eligibleById = new Map(eligible.map((record) => [record.id, record]));
  const keywordById = new Map(keywordMatches.map((match) => [match.record.id, match]));
  const semanticOnly: CharacterKnowledgeMatch[] = [];
  for (const result of semanticMatches.slice(0, 32)) {
    const record = eligibleById.get(result.recordId);
    if (!record || !Number.isFinite(result.score) || result.score < 0 || result.score > 1) continue;
    const keyword = keywordById.get(result.recordId);
    if (keyword) {
      keyword.semanticScore = Math.max(keyword.semanticScore ?? 0, result.score);
      keyword.matchReasons.push('可选语义补充');
    } else {
      semanticOnly.push({
        record,
        keywordScore: 0,
        semanticScore: result.score,
        matchReasons: ['可选语义补充'],
      });
    }
  }
  semanticOnly.sort(
    (left, right) =>
      (right.semanticScore ?? 0) - (left.semanticScore ?? 0) ||
      right.record.importance - left.record.importance ||
      left.record.id.localeCompare(right.record.id),
  );
  return applyBudget([...keywordMatches, ...semanticOnly], maximumRecords, maximumCharacters);
};

const bestRecordOfKind = (
  records: readonly CharacterKnowledgeRecord[],
  characterNamespace: string,
  kind: CharacterKnowledgeKind,
): CharacterKnowledgeRecord | undefined =>
  records
    .filter((record) => record.characterNamespace === characterNamespace && record.kind === kind)
    .sort(
      (left, right) => right.importance - left.importance || left.id.localeCompare(right.id),
    )[0];

export const retrieveCharacterKnowledgeForPrompt = async (
  input: CharacterKnowledgeQuery,
  records: readonly CharacterKnowledgeRecord[],
  semanticRetriever?: SemanticCharacterKnowledgeRetriever,
): Promise<CharacterKnowledgeMatch[]> => {
  const validatedRecords = records.map(validateCharacterKnowledgeRecord);
  const contextual = await retrieveCharacterKnowledge(
    { ...input, maximumRecords: 8, maximumCharacters: 8_000 },
    validatedRecords,
    semanticRetriever,
  );
  const identity = bestRecordOfKind(validatedRecords, input.characterNamespace, 'identity');
  const speechRule = bestRecordOfKind(validatedRecords, input.characterNamespace, 'speech-rule');
  const stableIds = new Set(
    [identity?.id, speechRule?.id].filter((id): id is string => Boolean(id)),
  );
  const contextualWithoutStable = contextual.filter(({ record }) => !stableIds.has(record.id));
  const trait = bestRecordOfKind(validatedRecords, input.characterNamespace, 'trait');
  const preferred: CharacterKnowledgeMatch[] = [identity, speechRule]
    .filter((record): record is CharacterKnowledgeRecord => Boolean(record))
    .map((record) => ({ record, keywordScore: 0, matchReasons: ['常驻角色核心'] }));
  preferred.push(...contextualWithoutStable);
  if (trait && !preferred.some(({ record }) => record.id === trait.id)) {
    preferred.push({ record: trait, keywordScore: 0, matchReasons: ['常驻角色核心'] });
  }
  return applyBudget(
    preferred,
    boundedInteger(input.maximumRecords, 4, 8),
    Math.max(200, boundedInteger(input.maximumCharacters, 2_400, 8_000)),
  );
};

export const formatCharacterKnowledgeContext = (
  matches: readonly CharacterKnowledgeMatch[],
): string => {
  if (matches.length === 0) return '';
  return [
    '当前问题命中的角色资料（属于角色设定，不是用户长期记忆）：',
    ...matches.map(({ record }) => {
      const sources = uniqueStrings(record.evidence.map(({ sourceId }) => sourceId));
      return `- [${record.kind}] ${record.title}：${record.content}\n  字段：${uniqueStrings(record.evidence.map(({ fieldPath }) => fieldPath)).join('、') || '未迁移'}；来源：${sources.join('、') || '待补证据'}`;
    }),
  ].join('\n');
};
