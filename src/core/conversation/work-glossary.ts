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

const MAX_QUERY_VARIANTS = 3;
const MAX_QUERY_CHARACTERS = 800;
const RRF_RANK_CONSTANT = 60;

export interface WorkGlossaryQueryContext {
  message: string;
  recentMessages?: readonly string[];
}

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

const extractFocusedQuery = (message: string): string | undefined => {
  const normalized = normalize(message);
  const quoted = normalized.match(/[“"「『]([^”"」』]{1,80})[”"」』]/u)?.[1]?.trim();
  if (quoted) return quoted;
  const explained = normalized.match(
    /([a-z0-9][a-z0-9._-]{1,39}|[\u3400-\u9fff]{2,20})(?:是什么梗|什么梗|是什么意思|什么意思|啥意思)/u,
  )?.[1];
  const candidate = explained?.trim();
  if (!candidate || /^(?:这个|那个|这些|那些|它|他|她)(?:又是|是|叫|说)?$/u.test(candidate)) {
    return undefined;
  }
  return candidate;
};

export const buildWorkGlossaryQueries = ({
  message,
  recentMessages = [],
}: WorkGlossaryQueryContext): string[] => {
  const current = message.trim().slice(0, MAX_QUERY_CHARACTERS);
  if (!current) return [];
  const focused = extractFocusedQuery(current);
  const previous = [...recentMessages]
    .reverse()
    .map((value) => value.trim())
    .find((value) => value && normalize(value) !== normalize(current));
  return uniqueStrings([
    current,
    ...(focused ? [focused] : []),
    ...(previous
      ? [`${previous.slice(0, MAX_QUERY_CHARACTERS / 2)} ${current}`.slice(0, MAX_QUERY_CHARACTERS)]
      : []),
  ]).slice(0, MAX_QUERY_VARIANTS);
};

const rankEntries = (
  query: string,
  entries: readonly WorkGlossaryEntry[],
): Array<{ entry: WorkGlossaryEntry; score: number }> =>
  entries
    .map((entry) => ({ entry, score: searchScore(normalize(query), entry) }))
    .filter(({ score }) => score > 0)
    .sort(
      (first, second) =>
        second.score - first.score ||
        second.entry.confidence - first.entry.confidence ||
        first.entry.term.localeCompare(second.entry.term, 'zh-CN'),
    );

const findRelatedEntries = (
  entry: WorkGlossaryEntry,
  entries: readonly WorkGlossaryEntry[],
  selectedTerms: ReadonlySet<string>,
): WorkGlossaryEntry[] => {
  const relationText = normalize(`${entry.meaning} ${entry.originContext}`);
  return entries
    .filter((candidate) => !selectedTerms.has(normalize(candidate.term)))
    .filter((candidate) =>
      [candidate.term, ...candidate.aliases].some((alias) => containsAlias(relationText, alias)),
    )
    .sort(
      (first, second) =>
        second.confidence - first.confidence || first.term.localeCompare(second.term, 'zh-CN'),
    );
};

export const findRelevantGlossaryEntriesForContext = (
  context: WorkGlossaryQueryContext,
  entries: readonly WorkGlossaryEntry[],
  limit = 3,
  maximumRelationDepth = 2,
): WorkGlossaryEntry[] => {
  const safeLimit = Math.max(0, Math.min(8, Math.trunc(limit)));
  if (safeLimit === 0) return [];
  const validatedEntries = entries.map((entry) => validateWorkGlossaryEntry(entry));
  const rankings = new Map<
    string,
    { entry: WorkGlossaryEntry; exact: boolean; reciprocalRank: number; bestScore: number }
  >();
  for (const query of buildWorkGlossaryQueries(context)) {
    rankEntries(query, validatedEntries).forEach(({ entry, score }, index) => {
      const key = normalize(entry.term);
      const previous = rankings.get(key);
      rankings.set(key, {
        entry,
        exact: (previous?.exact ?? false) || score >= 100,
        reciprocalRank: (previous?.reciprocalRank ?? 0) + 1 / (RRF_RANK_CONSTANT + index + 1),
        bestScore: Math.max(previous?.bestScore ?? 0, score),
      });
    });
  }
  const selected = [...rankings.values()]
    .sort(
      (first, second) =>
        Number(second.exact) - Number(first.exact) ||
        second.reciprocalRank - first.reciprocalRank ||
        second.bestScore - first.bestScore ||
        second.entry.confidence - first.entry.confidence ||
        first.entry.term.localeCompare(second.entry.term, 'zh-CN'),
    )
    .map(({ entry }) => entry)
    .slice(0, safeLimit);

  const selectedTerms = new Set(selected.map((entry) => normalize(entry.term)));
  let frontier = [...selected];
  const depthLimit = Math.max(0, Math.min(2, Math.trunc(maximumRelationDepth)));
  for (let depth = 0; depth < depthLimit && selected.length < safeLimit; depth += 1) {
    const next: WorkGlossaryEntry[] = [];
    for (const seed of frontier) {
      for (const related of findRelatedEntries(seed, validatedEntries, selectedTerms)) {
        const key = normalize(related.term);
        if (selectedTerms.has(key)) continue;
        selected.push(related);
        selectedTerms.add(key);
        next.push(related);
        if (selected.length >= safeLimit) break;
      }
      if (selected.length >= safeLimit) break;
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return selected;
};

export const findRelevantGlossaryEntries = (
  message: string,
  entries: readonly WorkGlossaryEntry[],
  limit = 3,
): WorkGlossaryEntry[] => {
  return findRelevantGlossaryEntriesForContext({ message }, entries, limit, 0);
};

export const formatWorkGlossaryContext = (entries: readonly WorkGlossaryEntry[]): string => {
  if (entries.length === 0) return '';
  return [
    '当前作品社区词库命中（这是玩家社区语境，不是角色世界观事实）：',
    ...entries.map(
      (entry) =>
        `- ${entry.term}（别名：${entry.aliases.join('、') || '无'}；置信度 ${entry.confidence.toFixed(2)}）：${entry.meaning}\n  来源与语境：${entry.originContext}\n  参考：${entry.sources.map((source) => `${source.siteName} ${source.url}`).join('；')}`,
    ),
    '回答时可以保持角色口吻，并用“如果你指社区里说的……”区分社区梗与作品内事实；不得因为角色在世界观内不接触现实社区而拒绝解释。',
  ].join('\n');
};
