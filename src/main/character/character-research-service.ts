import { randomUUID } from 'node:crypto';

import type { CharacterLore } from '../../core/character/character-lore';
import type {
  CharacterResearchCandidate,
  CharacterResearchDraft,
} from '../../core/character/character-research';
import { DEFAULT_CHARACTER_PROFILE } from '../../core/conversation/character-profile';

export interface CharacterLoreGenerationInput {
  canonicalName: string;
  sourceWork: string;
  sourceText: string;
}

export interface CharacterLoreGenerator {
  generateCharacterLore(
    input: CharacterLoreGenerationInput,
    signal?: AbortSignal,
  ): Promise<Partial<Omit<CharacterLore, 'sources'>>>;
}

interface CharacterSourceDefinition {
  id: string;
  label: string;
  origin: string;
  apiPath: string;
  articlePath: string;
  workHints: string[];
  canonicalWork: string;
  detailSuffixes: string[];
  parseMainPage?: boolean;
}

interface CandidateRecord {
  candidate: CharacterResearchCandidate;
  source: CharacterSourceDefinition;
  pageId: number;
  title: string;
  expiresAt: number;
}

interface MediaWikiSearchResponse {
  query?: {
    search?: Array<{
      pageid?: unknown;
      title?: unknown;
      snippet?: unknown;
    }>;
  };
}

interface MediaWikiExtractResponse {
  query?: {
    pages?: Array<{
      pageid?: unknown;
      title?: unknown;
      fullurl?: unknown;
      extract?: unknown;
      missing?: unknown;
    }>;
  };
}

interface MediaWikiParseResponse {
  parse?: { title?: unknown; text?: unknown };
}

const SOURCES: readonly CharacterSourceDefinition[] = [
  {
    id: 'arknights-terra-wiki',
    label: 'Arknights Terra Wiki',
    origin: 'https://arknights.wiki.gg',
    apiPath: '/api.php',
    articlePath: '/wiki/',
    workHints: ['明日方舟', 'arknights'],
    canonicalWork: '明日方舟 / Arknights',
    detailSuffixes: ['/File', '/Dialogue'],
  },
  {
    id: 'prts-wiki',
    label: 'PRTS Wiki',
    origin: 'https://prts.wiki',
    apiPath: '/api.php',
    articlePath: '/w/',
    workHints: ['明日方舟', 'arknights'],
    canonicalWork: '明日方舟 / Arknights',
    detailSuffixes: ['/语音记录'],
    parseMainPage: true,
  },
  {
    id: 'zh-wikipedia',
    label: '中文维基百科',
    origin: 'https://zh.wikipedia.org',
    apiPath: '/w/api.php',
    articlePath: '/wiki/',
    workHints: [],
    canonicalWork: '',
    detailSuffixes: [],
  },
  {
    id: 'en-wikipedia',
    label: 'English Wikipedia',
    origin: 'https://en.wikipedia.org',
    apiPath: '/w/api.php',
    articlePath: '/wiki/',
    workHints: [],
    canonicalWork: '',
    detailSuffixes: [],
  },
];

const USER_AGENT = 'For-People-No-Friend/1.0 (https://github.com/ph1gros/for-people-no-friend)';
const MAX_RESPONSE_CHARACTERS = 1_000_000;
const MAX_SOURCE_TEXT_CHARACTERS = 4_200;
const CANDIDATE_TTL_MS = 10 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 5_000;
const GENERATION_TIMEOUT_MS = 30_000;

const normalize = (value: string): string => value.normalize('NFKC').trim().toLowerCase();

const decodeSnippet = (value: string): string =>
  value
    .replace(/<[^>]*>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

const sourceMatchesWork = (source: CharacterSourceDefinition, sourceWork: string): boolean => {
  const normalizedWork = normalize(sourceWork);
  return (
    Boolean(normalizedWork) &&
    source.workHints.some(
      (hint) =>
        normalizedWork.includes(normalize(hint)) || normalize(hint).includes(normalizedWork),
    )
  );
};

const decodeCodePoint = (value: string, radix: number): string => {
  const codePoint = Number.parseInt(value, radix);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : '';
};

const htmlToPlainText = (value: string): string =>
  value
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_match, code: string) => decodeCodePoint(code, 10))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => decodeCodePoint(code, 16))
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const boundedString = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const boundedStrings = (value: unknown, maximumItems: number, maximum: number): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim().slice(0, maximum))
            .filter(Boolean),
        ),
      ].slice(0, maximumItems)
    : [];

const generationFailureWarning = (error: unknown): string => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : '';
  switch (code) {
    case 'configuration':
      return '资料已找到，但当前模型配置不完整。请先在设置中测试模型连接，然后重新整理。';
    case 'authentication':
      return '资料已找到，但模型认证失败。请检查模型连接，然后重新整理。';
    case 'model-not-found':
      return '资料已找到，但当前填写的模型不可用。请检查模型名称，然后重新整理。';
    case 'rate-limit':
      return '资料已找到，但模型当前达到用量限制。请稍后重新整理。';
    case 'network':
      return '资料已找到，但暂时无法连接模型服务。请检查网络后重新整理。';
    default:
      return '资料已找到，但模型返回的内容无法整理成角色设定。你可以重新整理或手动填写。';
  }
};

const boundedChineseText = (value: unknown, maximum: number): string => {
  const text = boundedString(value, maximum);
  if (!text || !/[\u3400-\u9fff]/u.test(text) || /\[source_\d+\]/iu.test(text)) return '';
  return text;
};

const inferUserDisplayName = (speechStyle: string): string => {
  const match =
    /(?:对用户(?:的)?称呼|称呼用户|称用户)(?:为|是|作)?[“”「」『』'"\s]*([^，。；、\n“”「」『』'"]{1,20})/u.exec(
      speechStyle,
    );
  return match?.[1]?.trim() || DEFAULT_CHARACTER_PROFILE.userDisplayName;
};

const buildProfileFields = (
  lore: Pick<CharacterLore, 'identity' | 'personality' | 'speechStyle'>,
): CharacterResearchDraft['profileFields'] => ({
  userDisplayName: inferUserDisplayName(lore.speechStyle),
  bio: lore.identity || DEFAULT_CHARACTER_PROFILE.bio,
  personaPrompt:
    [
      lore.personality ? `性格：${lore.personality}` : '',
      lore.speechStyle ? `说话方式：${lore.speechStyle}` : '',
    ]
      .filter(Boolean)
      .join('\n') || DEFAULT_CHARACTER_PROFILE.personaPrompt,
});

const selectSourceText = (pages: Array<{ title: string; extract: string }>): string => {
  const hasDetailPages = pages.some((page) => /\/(file|dialogue|语音记录)$/iu.test(page.title));
  const hasChineseVoicePage = pages.some((page) => /\/语音记录$/u.test(page.title));
  const prioritizedPages = pages
    .map((page, index) => ({ page, index }))
    .sort((left, right) => {
      const priority = (title: string): number =>
        /\/语音记录$/u.test(title)
          ? 4
          : /\/dialogue$/iu.test(title)
            ? 3
            : /\/file$/iu.test(title)
              ? 2
              : 1;
      return priority(right.page.title) - priority(left.page.title);
    });
  return prioritizedPages
    .map(({ page, index }) => {
      const pageBudget = hasDetailPages
        ? /\/语音记录$/u.test(page.title)
          ? 2_200
          : /\/dialogue$/iu.test(page.title)
            ? hasChineseVoicePage
              ? 900
              : 2_000
            : /\/file$/iu.test(page.title)
              ? hasChineseVoicePage
                ? 700
                : 1_300
              : hasChineseVoicePage
                ? 300
                : 500
        : Math.floor(MAX_SOURCE_TEXT_CHARACTERS / Math.max(1, pages.length));
      const usefulText = page.extract
        .split(/\n\s*\n|\n(?=[A-Z][^\n]{0,50}:)/u)
        .map((part) => part.replace(/[ \t]+/g, ' ').trim())
        .filter(
          (part) =>
            part.length >= 4 &&
            !/^(navigation|this article|operator\s+file|干员信息|目录|导航)\b/iu.test(part),
        )
        .join('\n\n')
        .slice(0, pageBudget);
      return usefulText ? `[source_${index + 1}] ${page.title}\n${usefulText}` : '';
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_SOURCE_TEXT_CHARACTERS);
};

export class CharacterResearchService {
  private readonly candidates = new Map<string, CandidateRecord>();
  private readonly active = new Map<string, AbortController>();

  public constructor(
    private readonly fetcher: typeof globalThis.fetch,
    private readonly generator?: CharacterLoreGenerator,
  ) {}

  public async search(
    requestId: string,
    name: string,
    sourceWork: string,
  ): Promise<CharacterResearchCandidate[]> {
    return this.run(requestId, async (signal) => {
      this.pruneCandidates();
      const matchedSources = SOURCES.filter((source) => sourceMatchesWork(source, sourceWork));
      const collected: Array<{ record: CandidateRecord; score: number }> = [];
      if (matchedSources.length > 0) {
        for (const source of matchedSources) {
          try {
            const results = await this.searchSource(source, name, sourceWork, signal);
            collected.push(...results);
            const exact = results.filter(
              ({ record }) => normalize(record.candidate.name) === normalize(name),
            );
            if (exact.length > 0) {
              return this.storeCandidates(exact.slice(0, 1));
            }
          } catch {
            if (signal.aborted) return [];
            // A failed preferred source falls through to the next matching source.
          }
        }
      } else {
        const generalSources = SOURCES.filter((source) => source.workHints.length === 0);
        const settled = await Promise.allSettled(
          generalSources.map((source) => this.searchSource(source, name, sourceWork, signal)),
        );
        collected.push(
          ...settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
        );
      }
      return this.storeCandidates(
        collected.sort((left, right) => right.score - left.score).slice(0, 3),
      );
    });
  }

  public async buildDraft(requestId: string, candidateId: string): Promise<CharacterResearchDraft> {
    return this.run(requestId, async (signal) => {
      this.pruneCandidates();
      const record = this.candidates.get(candidateId);
      if (!record) {
        throw new Error('The selected character candidate has expired.');
      }
      const pages = await this.fetchPages(record, signal);
      if (pages.length === 0) {
        throw new Error('The selected character page is unavailable.');
      }
      const retrievedAt = Date.now();
      const sources = pages.slice(0, 8).map((page, index) => ({
        id: `source_${index + 1}`,
        title: page.title,
        url: page.url,
        siteName: page.siteName,
        retrievedAt,
      }));
      const sourceText = selectSourceText(pages);
      const fallback: Omit<CharacterLore, 'sources'> = {
        canonicalName: record.candidate.name,
        aliases: [],
        sourceWork: record.candidate.sourceWork,
        identity: '',
        personality: '',
        background: '',
        relationships: [],
        speechStyle: '',
      };
      let generated: Partial<Omit<CharacterLore, 'sources'>> = {};
      const warnings: string[] = [];
      if (this.generator && sourceText) {
        const generationTimeout = AbortSignal.timeout(GENERATION_TIMEOUT_MS);
        try {
          generated = await this.generator.generateCharacterLore(
            {
              canonicalName: fallback.canonicalName,
              sourceWork: fallback.sourceWork,
              sourceText,
            },
            AbortSignal.any([signal, generationTimeout]),
          );
        } catch (error) {
          if (signal.aborted) throw error;
          warnings.push(
            generationTimeout.aborted
              ? '资料已找到，但模型在 30 秒内没有完成整理。你可以直接重新整理或手动填写。'
              : generationFailureWarning(error),
          );
        }
      } else {
        warnings.push(
          '资料已找到，但当前没有可用的模型整理。详细字段保持为空，你可以配置模型后重试或手动填写。',
        );
      }
      const identity = boundedChineseText(generated.identity, 1_000);
      const personality = boundedChineseText(generated.personality, 2_000);
      const background = boundedChineseText(generated.background, 4_000);
      const relationships = boundedStrings(generated.relationships, 20, 300).filter((item) =>
        /[\u3400-\u9fff]/u.test(item),
      );
      const speechStyle = boundedChineseText(generated.speechStyle, 2_000);
      if (
        this.generator &&
        warnings.length === 0 &&
        !identity &&
        !personality &&
        !background &&
        relationships.length === 0 &&
        !speechStyle
      ) {
        warnings.push(
          '资料已找到，但模型没有生成可用的中文角色设定。详细字段保持为空，你可以重试或手动填写。',
        );
      }
      const lore: CharacterLore = {
        canonicalName: fallback.canonicalName,
        aliases: boundedStrings(generated.aliases, 20, 120),
        sourceWork: fallback.sourceWork,
        identity,
        personality,
        background,
        relationships,
        speechStyle,
        sources,
      };
      return {
        lore,
        profileFields: buildProfileFields(lore),
        warnings,
      };
    });
  }

  public cancel(requestId: string): boolean {
    const controller = this.active.get(requestId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  public dispose(): void {
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
    this.candidates.clear();
  }

  private async run<T>(
    requestId: string,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.active.has(requestId)) {
      throw new Error('A character research request with this ID is already running.');
    }
    const controller = new AbortController();
    this.active.set(requestId, controller);
    try {
      return await operation(controller.signal);
    } finally {
      this.active.delete(requestId);
    }
  }

  private async searchSource(
    source: CharacterSourceDefinition,
    name: string,
    sourceWork: string,
    signal: AbortSignal,
  ): Promise<Array<{ record: CandidateRecord; score: number }>> {
    const workMatches = sourceMatchesWork(source, sourceWork);
    const query = workMatches ? name : [name, sourceWork].filter(Boolean).join(' ');
    const url = new URL(source.apiPath, source.origin);
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      list: 'search',
      srsearch: query,
      srlimit: '5',
      srnamespace: '0',
    }).toString();
    const body = await this.fetchJson<MediaWikiSearchResponse>(url, source, signal);
    const normalizedName = normalize(name);
    return (body.query?.search ?? []).flatMap((item, index) => {
      if (typeof item.pageid !== 'number' || typeof item.title !== 'string') return [];
      const title = item.title.trim();
      if (!title) return [];
      const normalizedTitle = normalize(title);
      const exactName = normalizedTitle === normalizedName;
      const containsName = normalizedTitle.includes(normalizedName);
      const score =
        (exactName ? 120 : containsName ? 60 : Math.max(0, 30 - index * 4)) +
        (workMatches ? 100 : 0);
      const candidateId = `candidate_${randomUUID().replaceAll('-', '')}`;
      const sourceUrl = new URL(
        `${source.articlePath}${encodeURIComponent(title.replaceAll(' ', '_'))}`,
        source.origin,
      ).toString();
      const decodedDescription = decodeSnippet(boundedString(item.snippet, 2_000));
      const description = /\{\{|\}\}|\[\[/u.test(decodedDescription)
        ? `${source.label} 中的角色资料`
        : decodedDescription;
      const candidate: CharacterResearchCandidate = {
        id: candidateId,
        name: title,
        sourceWork: source.canonicalWork || sourceWork,
        description,
        sourceName: source.label,
        sourceUrl,
        matchReason:
          workMatches && exactName
            ? `名称与“${sourceWork}”完全匹配`
            : workMatches
              ? `资料源与“${sourceWork}”匹配`
              : exactName
                ? '页面标题与角色名完全一致'
                : '页面内容与名称相关',
      };
      return [
        {
          score,
          record: {
            candidate,
            source,
            pageId: item.pageid,
            title,
            expiresAt: Date.now() + CANDIDATE_TTL_MS,
          },
        },
      ];
    });
  }

  private async fetchPages(
    record: CandidateRecord,
    signal: AbortSignal,
  ): Promise<Array<{ title: string; url: string; extract: string; siteName: string }>> {
    const titles = [
      record.title,
      ...record.source.detailSuffixes.map((suffix) => `${record.title}${suffix}`),
    ];
    const url = new URL(record.source.apiPath, record.source.origin);
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'extracts|info',
      titles: titles.join('|'),
      explaintext: '1',
      exsectionformat: 'plain',
      inprop: 'url',
      redirects: '1',
    }).toString();
    const body = await this.fetchJson<MediaWikiExtractResponse>(url, record.source, signal);
    const extracted = (body.query?.pages ?? []).flatMap((page) => {
      if (page.missing !== undefined) return [];
      const title = boundedString(page.title, 300);
      const pageUrl = boundedString(page.fullurl, 2_000);
      const extract = boundedString(page.extract, 20_000);
      if (!title || !pageUrl || !extract) return [];
      let parsed: URL;
      try {
        parsed = new URL(pageUrl);
      } catch {
        return [];
      }
      if (parsed.protocol !== 'https:' || parsed.origin !== record.source.origin) return [];
      return [{ title, url: parsed.toString(), extract, siteName: record.source.label }];
    });
    const includedTitles = new Set(extracted.map((page) => page.title));
    const missingDetails = titles.slice(1).filter((title) => !includedTitles.has(title));
    const parseTitles = [...missingDetails, ...(record.source.parseMainPage ? [record.title] : [])];
    const parsedDetails = await Promise.allSettled(
      parseTitles.map((title) => this.fetchParsedPage(record.source, title, signal)),
    );
    const combined: Array<{ title: string; url: string; extract: string; siteName: string }> = [
      ...extracted,
      ...parsedDetails.flatMap((result) =>
        result.status === 'fulfilled' && result.value ? [result.value] : [],
      ),
    ];
    if (record.source.id === 'arknights-terra-wiki') {
      const prtsSource = SOURCES.find((source) => source.id === 'prts-wiki');
      if (prtsSource) {
        const supplementTimeout = AbortSignal.timeout(4_000);
        try {
          const voicePage = await this.fetchParsedPage(
            prtsSource,
            `${record.title}/语音记录`,
            AbortSignal.any([signal, supplementTimeout]),
          );
          if (voicePage) combined.push(voicePage);
        } catch (error) {
          if (signal.aborted) throw error;
          // The Chinese voice page is optional; English sources remain usable.
        }
      }
    }
    const byTitle = new Map<string, (typeof combined)[number]>();
    for (const page of combined) {
      const existing = byTitle.get(page.title);
      if (!existing || page.extract.length > existing.extract.length) byTitle.set(page.title, page);
    }
    return [...byTitle.values()].sort(
      (left, right) => Number(right.title === record.title) - Number(left.title === record.title),
    );
  }

  private async fetchParsedPage(
    source: CharacterSourceDefinition,
    title: string,
    signal: AbortSignal,
  ): Promise<{ title: string; url: string; extract: string; siteName: string } | undefined> {
    const url = new URL(source.apiPath, source.origin);
    url.search = new URLSearchParams({
      action: 'parse',
      format: 'json',
      formatversion: '2',
      page: title,
      prop: 'text',
      disableeditsection: '1',
    }).toString();
    const body = await this.fetchJson<MediaWikiParseResponse>(url, source, signal);
    const parsedTitle = boundedString(body.parse?.title, 300);
    const extract = htmlToPlainText(boundedString(body.parse?.text, 200_000)).slice(0, 20_000);
    if (!parsedTitle || !extract) return undefined;
    return {
      title: parsedTitle,
      url: new URL(
        `${source.articlePath}${encodeURIComponent(parsedTitle.replaceAll(' ', '_'))}`,
        source.origin,
      ).toString(),
      extract,
      siteName: source.label,
    };
  }

  private async fetchJson<T>(
    url: URL,
    source: CharacterSourceDefinition,
    signal: AbortSignal,
  ): Promise<T> {
    if (signal.aborted) throw new Error('The character research request was cancelled.');
    if (url.origin !== source.origin || url.pathname !== source.apiPath) {
      throw new Error('The character research URL is not allowed.');
    }
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await this.fetcher(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      redirect: 'error',
      signal: AbortSignal.any([signal, timeoutSignal]),
    });
    if (!response.ok) throw new Error(`Character source returned ${response.status}.`);
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType && !contentType.includes('application/json')) {
      throw new Error('The character source response type is invalid.');
    }
    if (response.url && new URL(response.url).origin !== source.origin) {
      throw new Error('The character source response origin is invalid.');
    }
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_RESPONSE_CHARACTERS) {
      throw new Error('The character source response is too large.');
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARACTERS) {
      throw new Error('The character source response is too large.');
    }
    return JSON.parse(text) as T;
  }

  private pruneCandidates(): void {
    const now = Date.now();
    for (const [id, record] of this.candidates) {
      if (record.expiresAt <= now) this.candidates.delete(id);
    }
  }

  private storeCandidates(
    candidates: Array<{ record: CandidateRecord; score: number }>,
  ): CharacterResearchCandidate[] {
    return candidates.map(({ record }) => {
      this.candidates.set(record.candidate.id, record);
      return record.candidate;
    });
  }
}
