export interface CharacterLore {
  canonicalName: string;
  aliases: string[];
  sourceWork: string;
  identity: string;
  personality: string;
  background: string;
  relationships: string[];
  speechStyle: string;
  sources: CharacterLoreSource[];
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

export const formatCharacterLore = (lore?: CharacterLore, includeDetails = false): string => {
  if (!lore) {
    return '';
  }
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
    lore.speechStyle
      ? '扮演要求：回复时自然采用上述称呼、语气、句式和措辞；不要向用户复述角色卡，也不要机械照抄示例台词。'
      : '',
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 8_000);
};
