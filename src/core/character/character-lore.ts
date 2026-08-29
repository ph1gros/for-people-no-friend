export interface CharacterLore {
  canonicalName: string;
  aliases: string[];
  sourceWork: string;
  identity: string;
  personality: string;
  background: string;
  relationships: string[];
  speechStyle: string;
  sampleLines?: string[];
  roleplayExamples?: CharacterRoleplayExample[];
  sources: CharacterLoreSource[];
}

export interface CharacterRoleplayExample {
  scene: string;
  emotion: string;
  trigger: string;
  attitude: string;
  line: string;
  sourceId?: string;
}

export interface CharacterLoreSource {
  id: string;
  title: string;
  url: string;
  siteName: string;
  retrievedAt: number;
}

export const sanitizeCharacterSpeechStyle = (value: string): string => {
  const text = value.normalize('NFKC').trim();
  if (!text) return '';
  const withoutEmptyQuotes = text.replace(/[“「『'"]\s*[”」』'"]/gu, '').trim();
  return /(?:^(?:对用户(?:的)?称呼|称呼用户|称用户)(?:(?:为|是|作|叫作)\s*)?|(?:称为|称作|叫作|直呼)\s*)[：:，,。；;、]*$/u.test(
    withoutEmptyQuotes,
  )
    ? ''
    : text;
};

export const shouldIncludeCharacterLoreDetails = (
  query: string,
  characterName: string,
  sourceWork = '',
): boolean => {
  const normalized = query.normalize('NFKC').toLowerCase();
  return (
    normalized.includes(characterName.normalize('NFKC').toLowerCase()) ||
    (sourceWork.length >= 2 && normalized.includes(sourceWork.normalize('NFKC').toLowerCase())) ||
    /(原作|设定|背景|身份|来自|出处|哪部|游戏|作品|故事|经历|过去|关系|朋友|家人|同伴|世界观|为什么)/u.test(
      normalized,
    )
  );
};

const EXAMPLE_INTENT_HINTS: ReadonlyArray<[RegExp, string[]]> = [
  [/(难过|伤心|不开心|沮丧|安慰|陪陪|失败|累了)/u, ['难过', '安慰', '关心', '低落']],
  [/(开心|高兴|太好了|成功|庆祝|夸夸|表扬)/u, ['开心', '称赞', '庆祝', '愉快']],
  [/(生气|气死|愤怒|讨厌|过分|争吵)/u, ['生气', '不满', '斥责', '愤怒']],
  [/(怀疑|真的|确定|靠谱吗|可疑|骗)/u, ['怀疑', '警惕', '质疑', '可疑']],
  [/(帮忙|怎么办|建议|认真|决定|选择)/u, ['认真', '帮助', '建议', '判断']],
  [/(你好|早上好|晚上好|在吗|聊聊|日常)/u, ['日常', '问候', '闲聊', '平静']],
  [
    /(玩笑|开玩笑|梗|接梗|中二|羞耻|黑历史|傲娇|口是心非|刚才说|你说过)/u,
    ['玩笑', '梗', '中二', '羞耻', '黑历史', '傲娇', '调侃', '口是心非', '回忆'],
  ],
];

export interface RoleplayExampleSelection {
  example: CharacterRoleplayExample;
  key: string;
  score: number;
  reasons: string[];
}

const exampleKey = (example: CharacterRoleplayExample): string =>
  `${example.scene}\u0000${example.trigger}\u0000${example.line}`;

export const selectContextualRoleplayExamples = (
  lore: CharacterLore,
  input: {
    query: string;
    recentMessages?: readonly string[];
    excludedKeys?: ReadonlySet<string>;
    maximum?: number;
    maximumCharacters?: number;
  },
): RoleplayExampleSelection[] => {
  const examples = lore.roleplayExamples ?? [];
  const maximum = input.maximum ?? 4;
  const maximumCharacters = input.maximumCharacters ?? 1_800;
  if (examples.length === 0 || maximum <= 0) return [];
  const normalizedQuery = input.query.normalize('NFKC').toLowerCase();
  const recentContext = (input.recentMessages ?? [])
    .slice(-6)
    .join(' ')
    .normalize('NFKC')
    .toLowerCase();
  const hintedWords = EXAMPLE_INTENT_HINTS.flatMap(([pattern, words]) =>
    pattern.test(normalizedQuery) || pattern.test(recentContext) ? words : [],
  );
  const ranked = examples
    .map((example, index) => {
      const key = exampleKey(example);
      const metadata = [example.scene, example.emotion, example.trigger, example.attitude]
        .join(' ')
        .normalize('NFKC')
        .toLowerCase();
      const terms = metadata.split(/[\s、，。；：:／/|｜]+/u).filter((term) => term.length >= 2);
      const directMatches = terms.filter((term) => normalizedQuery.includes(term)).length;
      const recentMatches = terms.filter((term) => recentContext.includes(term)).length;
      const intentWords = hintedWords.filter((word) => metadata.includes(word));
      const quotedOwnLine = [...example.line.normalize('NFKC')]
        .filter((character) => /[\p{L}\p{N}]/u.test(character))
        .join('');
      const callbackMatch =
        quotedOwnLine.length >= 4 &&
        [...Array(Math.max(0, quotedOwnLine.length - 3)).keys()].some((offset) =>
          normalizedQuery.includes(quotedOwnLine.slice(offset, offset + 4)),
        );
      const generalBonus = /(日常|平静|闲聊|通用)/u.test(metadata) ? 1 : 0;
      const reasons = [
        directMatches ? `当前消息命中 ${directMatches} 个情境词` : '',
        recentMatches ? `最近上下文命中 ${recentMatches} 个情境词` : '',
        intentWords.length ? `意图匹配：${[...new Set(intentWords)].join('、')}` : '',
        callbackMatch ? '用户提到了角色自己的示例台词' : '',
        generalBonus ? '通用日常回退' : '',
      ].filter(Boolean);
      return {
        example,
        key,
        index,
        score:
          directMatches * 5 +
          recentMatches * 2 +
          intentWords.length * 3 +
          (callbackMatch ? 10 : 0) +
          generalBonus,
        reasons,
      };
    })
    .filter(({ key, score }) => score > 0 && !input.excludedKeys?.has(key))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected: RoleplayExampleSelection[] = [];
  let usedCharacters = 0;
  for (const item of ranked) {
    const size = [
      item.example.scene,
      item.example.emotion,
      item.example.trigger,
      item.example.attitude,
      item.example.line,
    ].join('').length;
    if (selected.length >= Math.min(4, maximum)) break;
    if (selected.length > 0 && usedCharacters + size > maximumCharacters) continue;
    selected.push(item);
    usedCharacters += size;
  }
  return selected;
};

export const selectRoleplayExamples = (
  lore: CharacterLore,
  query: string,
  maximum = 4,
  maximumCharacters = 1_800,
): CharacterRoleplayExample[] => {
  return selectContextualRoleplayExamples(lore, { query, maximum, maximumCharacters }).map(
    ({ example }) => example,
  );
};

export const formatCharacterLore = (
  lore?: CharacterLore,
  includeDetails = false,
  currentUserMessage = '',
  selectedExamplesOverride?: readonly CharacterRoleplayExample[],
): string => {
  if (!lore) {
    return '';
  }
  const selectedExamples =
    selectedExamplesOverride ?? selectRoleplayExamples(lore, currentUserMessage);
  const hasStructuredExamples = (lore.roleplayExamples?.length ?? 0) > 0;
  return [
    '用户已确认的角色资料（这是角色设定，不是用户长期记忆）：',
    `正式名称：${lore.canonicalName}`,
    lore.aliases.length > 0 ? `别名：${lore.aliases.join('、')}` : '',
    lore.sourceWork ? `来源作品或游戏：${lore.sourceWork}` : '',
    lore.identity ? `身份：${lore.identity}` : '',
    lore.personality ? `性格：${lore.personality}` : '',
    includeDetails && lore.background ? `背景：${lore.background}` : '',
    includeDetails && lore.relationships.length > 0
      ? `重要关系：${lore.relationships.join('；')}`
      : '',
    lore.speechStyle ? `必须遵循的角色说话方式：${lore.speechStyle}` : '',
    selectedExamples.length
      ? [
          '当前情境命中的角色反应示例（不是已经发生的聊天记录；学习行为与语气，不要逐字复读）：',
          ...selectedExamples.map(
            (example) =>
              `- 场景：${example.scene}；情绪：${example.emotion}；触发：${example.trigger}；态度：${example.attitude}；示例：${example.line}`,
          ),
        ].join('\n')
      : !hasStructuredExamples && lore.sampleLines?.length
        ? `短台词示例（只模仿节奏和措辞，不要机械复读）：${lore.sampleLines.join('；')}`
        : '',
    lore.speechStyle
      ? '扮演要求：回复时自然采用上述称呼、语气、句式和措辞；不要向用户复述角色卡，也不要机械照抄示例台词。'
      : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 8_000);
};
