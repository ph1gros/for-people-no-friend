export interface WorkGlossarySource {
  title: string;
  url: string;
  siteName: string;
}

export interface WorkGlossaryEntry {
  term: string;
  aliases: string[];
  meaning: string;
  originContext: string;
  sources: WorkGlossarySource[];
  lastVerified: number;
  confidence: number;
}

const normalize = (value: string): string => value.normalize('NFKC').trim().toLowerCase();
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const resolveWorkGlossaryId = (sourceWork: string): string | undefined => {
  const normalized = normalize(sourceWork).replace(/[《》\s_-]/g, '');
  if (normalized.includes('明日方舟') || normalized.includes('arknights')) return 'arknights';
  if (
    normalized.includes('魔女之旅') ||
    normalized.includes('魔女の旅々') ||
    normalized.includes('wanderingwitch') ||
    normalized.includes('journeyofelaina')
  ) {
    return 'wandering-witch';
  }
  return undefined;
};

const containsAlias = (message: string, alias: string): boolean => {
  const candidate = normalize(alias);
  if (!candidate) return false;
  if (/^[a-z0-9]+$/.test(candidate)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(candidate)}($|[^a-z0-9])`, 'i').test(message);
  }
  return message.includes(candidate);
};

export const findRelevantGlossaryEntries = (
  message: string,
  entries: readonly WorkGlossaryEntry[],
  limit = 3,
): WorkGlossaryEntry[] => {
  const normalizedMessage = normalize(message);
  return entries
    .filter((entry) =>
      [entry.term, ...entry.aliases].some((alias) => containsAlias(normalizedMessage, alias)),
    )
    .sort((first, second) => second.confidence - first.confidence)
    .slice(0, limit);
};

export const formatWorkGlossaryContext = (entries: readonly WorkGlossaryEntry[]): string => {
  if (entries.length === 0) return '';
  return [
    '当前作品词库命中（可能是作品专名或玩家社区语境，请按条目的来源与语境区分）：',
    ...entries.map(
      (entry) =>
        `- ${entry.term}（别名：${entry.aliases.join('、') || '无'}；置信度 ${entry.confidence.toFixed(2)}）：${entry.meaning}\n  来源与语境：${entry.originContext}\n  参考：${entry.sources.map((source) => `${source.siteName} ${source.url}`).join('；')}`,
    ),
    '回答时可以保持角色口吻；作品专名按来源说明，玩家梗则用“如果你指社区里说的……”与原作事实区分。',
  ].join('\n');
};
