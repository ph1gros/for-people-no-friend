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
const uniqueStrings = (values: readonly string[]): string[] => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
];

const validateSource = (value: unknown): WorkGlossarySource => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The work glossary source is invalid.');
  }
  const source = value as Partial<WorkGlossarySource>;
  if (
    typeof source.title !== 'string' ||
    !source.title.trim() ||
    source.title.length > 300 ||
    typeof source.siteName !== 'string' ||
    !source.siteName.trim() ||
    source.siteName.length > 200 ||
    typeof source.url !== 'string' ||
    source.url.length > 2_000
  ) {
    throw new Error('The work glossary source is invalid.');
  }
  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    throw new Error('The work glossary source is invalid.');
  }
  const loopback =
    url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !loopback) || url.username || url.password) {
    throw new Error('The work glossary source is invalid.');
  }
  return {
    title: source.title.trim(),
    siteName: source.siteName.trim(),
    url: url.toString(),
  };
};

export const validateWorkGlossaryEntry = (value: unknown): WorkGlossaryEntry => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The work glossary entry is invalid.');
  }
  const entry = value as Partial<WorkGlossaryEntry>;
  if (
    typeof entry.term !== 'string' ||
    !entry.term.trim() ||
    entry.term.length > 200 ||
    !Array.isArray(entry.aliases) ||
    entry.aliases.length > 80 ||
    entry.aliases.some(
      (alias) => typeof alias !== 'string' || !alias.trim() || alias.length > 200,
    ) ||
    typeof entry.meaning !== 'string' ||
    !entry.meaning.trim() ||
    entry.meaning.length > 4_000 ||
    typeof entry.originContext !== 'string' ||
    !entry.originContext.trim() ||
    entry.originContext.length > 2_000 ||
    !Array.isArray(entry.sources) ||
    entry.sources.length > 20 ||
    typeof entry.lastVerified !== 'number' ||
    !Number.isFinite(entry.lastVerified) ||
    entry.lastVerified <= 0 ||
    typeof entry.confidence !== 'number' ||
    !Number.isFinite(entry.confidence) ||
    entry.confidence < 0 ||
    entry.confidence > 1
  ) {
    throw new Error('The work glossary entry is invalid.');
  }
  return {
    term: entry.term.trim(),
    aliases: uniqueStrings(entry.aliases as string[]),
    meaning: entry.meaning.trim(),
    originContext: entry.originContext.trim(),
    sources: (entry.sources as WorkGlossarySource[]).map(validateSource),
    lastVerified: Math.trunc(entry.lastVerified),
    confidence: entry.confidence,
  };
};

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

const tokenize = (value: string): Set<string> => {
  const tokens = new Set<string>();
  for (const match of normalize(value).matchAll(/[a-z0-9]+|[\u3400-\u9fff]+/gu)) {
    const token = match[0];
    if (/^[a-z0-9]+$/u.test(token)) {
      if (token.length >= 2) tokens.add(token);
      continue;
    }
    if (token.length <= 2) tokens.add(token);
    for (let index = 0; index < token.length - 1; index += 1) {
      tokens.add(token.slice(index, index + 2));
    }
  }
  return tokens;
};

const searchScore = (message: string, entry: WorkGlossaryEntry): number => {
  if ([entry.term, ...entry.aliases].some((alias) => containsAlias(message, alias))) return 100;
  const queryTokens = tokenize(message);
  const contentTokens = tokenize(`${entry.meaning} ${entry.originContext}`);
  const overlap = [...queryTokens].filter((token) => contentTokens.has(token));
  return overlap.length >= 2 ? overlap.length : 0;
};

export const findRelevantGlossaryEntries = (
  message: string,
  entries: readonly WorkGlossaryEntry[],
  limit = 3,
): WorkGlossaryEntry[] => {
  const normalizedMessage = normalize(message);
  return entries
    .map((entry) => validateWorkGlossaryEntry(entry))
    .map((entry) => ({ entry, score: searchScore(normalizedMessage, entry) }))
    .filter(({ score }) => score > 0)
    .sort(
      (first, second) =>
        second.score - first.score || second.entry.confidence - first.entry.confidence,
    )
    .map(({ entry }) => entry)
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
