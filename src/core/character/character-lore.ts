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
];

export const selectRoleplayExamples = (
  lore: CharacterLore,
  query: string,
  maximum = 4,
  maximumCharacters = 1_800,
): CharacterRoleplayExample[] => {
  const examples = lore.roleplayExamples ?? [];
  if (examples.length === 0 || maximum <= 0) return [];
  const normalizedQuery = query.normalize('NFKC').toLowerCase();
  const hintedWords = EXAMPLE_INTENT_HINTS.flatMap(([pattern, words]) =>
    pattern.test(normalizedQuery) ? words : [],
  );
  const ranked = examples
    .map((example, index) => {
      const metadata = [example.scene, example.emotion, example.trigger, example.attitude]
        .join(' ')
        .normalize('NFKC')
        .toLowerCase();
      const terms = metadata.split(/[\s、，。；：:／/|｜]+/u).filter((term) => term.length >= 2);
      const directMatches = terms.filter((term) => normalizedQuery.includes(term)).length;
      const intentMatches = hintedWords.filter((word) => metadata.includes(word)).length;
      const generalBonus = /(日常|平静|闲聊|通用)/u.test(metadata) ? 1 : 0;
      return { example, index, score: directMatches * 4 + intentMatches * 3 + generalBonus };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .filter(({ score }) => score > 0)
    .map(({ example }) => example);
  const selected: CharacterRoleplayExample[] = [];
  let usedCharacters = 0;
  for (const example of ranked) {
    const size = [
      example.scene,
      example.emotion,
      example.trigger,
      example.attitude,
      example.line,
    ].join('').length;
    if (selected.length >= Math.min(4, maximum)) break;
    if (selected.length > 0 && usedCharacters + size > maximumCharacters) continue;
    selected.push(example);
    usedCharacters += size;
  }
  return selected;
};

export const formatCharacterLore = (
  lore?: CharacterLore,
  includeDetails = false,
  currentUserMessage = '',
): string => {
  if (!lore) {
    return '';
  }
  const selectedExamples = selectRoleplayExamples(lore, currentUserMessage);
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
