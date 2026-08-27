import { createHash } from 'node:crypto';

import {
  findRelevantGlossaryEntriesForContext,
  resolveWorkGlossaryId,
  type WorkGlossaryEntry,
  type WorkGlossarySource,
} from '../../core/conversation/work-glossary';
import type { WorkGlossaryStatus, WorkGlossarySyncResult } from '../../shared/work-glossary-ipc';
import { WorkGlossaryStore } from '../storage/work-glossary-store';
import { CURATED_WORK_GLOSSARIES, type CuratedWorkGlossary } from './curated-work-glossaries';

type GlossaryFetch = (input: string, init?: RequestInit) => Promise<Response>;
const AKP_HANDBOOK_API = 'https://akp.fandom.com/zh/api.php';
const PUBLIC_SEARCH_URL = 'https://html.duckduckgo.com/html/';
const USER_AGENT = 'For-People-No-Friend/1.0 (https://github.com/ph1gros/for-people-no-friend)';
const MAX_SEARCH_RESPONSE_CHARACTERS = 1_000_000;
const COMMUNITY_MARKER =
  /(梗|黑话|黑稱|黑称|术语|術語|别名|別名|外号|外號|昵称|暱稱|迷因|二创|二創|童谣|童謠|口号|口號|台词|臺詞|meme|slang|glossary|nickname)/iu;
const SEARCH_RESULT_HOSTS = [
  'fandom.com',
  'wiki.gg',
  'prts.wiki',
  'moegirl.org.cn',
  'moegirl.icu',
  'moegirl.uk',
  'bilibili.com',
  'biligame.com',
  'hoyolab.com',
  'miyoushe.com',
  'wikipedia.org',
] as const;

interface PublicSearchItem {
  title: string;
  url: string;
  description: string;
}

interface DiscoveredPage extends PublicSearchItem {
  terms: Array<{ term: string; description: string }>;
}

const normalizeTermKey = (value: string): string =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

const sourceFamily = (source: WorkGlossarySource): string => {
  const url = new URL(source.url);
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return url.toString();
  if (url.hostname.includes('moegirl.')) return 'moegirl';
  return url.hostname.replace(/^(?:www|mobile|mzh|zh)\./u, '');
};

interface HandbookPage {
  title: string;
  fullurl: string;
  revisions?: Array<{
    timestamp?: string;
    slots?: { main?: { content?: string } };
  }>;
}

const uniqueSources = (entries: readonly WorkGlossaryEntry[]): WorkGlossarySource[] => {
  const sources = new Map<string, WorkGlossarySource>();
  for (const entry of entries) {
    for (const source of entry.sources) sources.set(source.url, source);
  }
  return [...sources.values()];
};

export class WorkGlossaryService {
  private readonly store: WorkGlossaryStore;

  public constructor(
    userDataPath: string,
    private readonly fetcher: GlossaryFetch,
    private readonly catalog: readonly CuratedWorkGlossary[] = CURATED_WORK_GLOSSARIES,
    private readonly handbookApiUrl: string | undefined = AKP_HANDBOOK_API,
    private readonly publicSearchUrl: string | undefined = PUBLIC_SEARCH_URL,
  ) {
    this.store = new WorkGlossaryStore(userDataPath);
  }

  public async findMatches(
    sourceWork: string,
    message: string,
    recentMessages: readonly string[] = [],
  ): Promise<WorkGlossaryEntry[]> {
    try {
      const glossary = this.resolve(sourceWork);
      if (!glossary) return [];
      const cached = await this.store.get(glossary.id);
      return findRelevantGlossaryEntriesForContext(
        { message, recentMessages },
        cached?.entries ?? glossary.entries,
      );
    } catch {
      return [];
    }
  }

  public async getStatus(sourceWork: string): Promise<WorkGlossaryStatus> {
    const glossary = this.resolve(sourceWork);
    if (!glossary) return { supported: false, entryCount: 0, sources: [] };
    const cached = await this.store.get(glossary.id);
    const entries = cached?.entries ?? glossary.entries;
    return {
      supported: true,
      workName: glossary.displayName,
      entryCount: entries.length,
      cacheOrigin: cached ? 'synced' : 'curated',
      ...(cached ? { lastSynced: cached.syncedAt } : {}),
      sources: uniqueSources(entries),
    };
  }

  public async sync(sourceWork: string): Promise<WorkGlossarySyncResult> {
    const glossary = this.resolve(sourceWork);
    if (!glossary) return { ok: false, message: '作品名称无效，无法同步社区词库。' };
    const previous = await this.store.get(glossary.id);
    let discoveredEntries: WorkGlossaryEntry[] = [];
    let searchFailed = false;
    let searchedQueries = 0;
    if (this.publicSearchUrl) {
      searchedQueries = 4;
      try {
        discoveredEntries = await this.discoverPublicEntries(glossary);
      } catch {
        searchFailed = true;
      }
    }
    let handbookEntries: WorkGlossaryEntry[] = [];
    let handbookFailed = false;
    if (glossary.id === 'arknights' && this.handbookApiUrl) {
      try {
        handbookEntries = await this.crawlHandbook();
      } catch {
        handbookFailed = true;
      }
    }
    const verifiedEntries: WorkGlossaryEntry[] = [];
    let checkedSources = 0;
    let verifiedSources = 0;
    const failedSourceTitles: string[] = [];
    for (const entry of glossary.entries) {
      const checks = await Promise.all(
        entry.sources.map(async (source) => ({
          source,
          verified: await this.verifySource(source, entry.evidence),
        })),
      );
      checkedSources += checks.length;
      verifiedSources += checks.filter((check) => check.verified).length;
      failedSourceTitles.push(
        ...checks.filter((check) => !check.verified).map((check) => check.source.title),
      );
      const sources = checks.filter((check) => check.verified).map((check) => check.source);
      if (sources.length === 0) continue;
      verifiedEntries.push({
        term: entry.term,
        aliases: entry.aliases,
        meaning: entry.meaning,
        originContext: entry.originContext,
        sources,
        lastVerified: Date.now(),
        confidence: sources.length >= 2 ? entry.confidence : Math.min(entry.confidence, 0.55),
      });
    }
    const mergedEntries = new Map<string, WorkGlossaryEntry>();
    const mergeEntry = (entry: WorkGlossaryEntry): void => {
      const key = normalizeTermKey(entry.term);
      const current = mergedEntries.get(key);
      if (!current || entry.confidence >= current.confidence) mergedEntries.set(key, entry);
    };
    for (const entry of previous?.entries ?? []) mergeEntry(entry);
    for (const entry of discoveredEntries) mergeEntry(entry);
    for (const entry of handbookEntries) mergeEntry(entry);
    for (const entry of verifiedEntries) mergeEntry(entry);
    const report = {
      searchedQueries,
      discoveredEntries: discoveredEntries.length,
      searchFailed,
      checkedSources,
      verifiedSources,
      failedSourceTitles: [...new Set(failedSourceTitles)].slice(0, 20),
      handbookEntries: handbookEntries.length,
      handbookFailed,
      cachedEntries: mergedEntries.size,
    };
    if (mergedEntries.size === 0) {
      return {
        ok: false,
        report,
        message: `同步未写入缓存：已执行 ${searchedQueries} 组联网搜索，但候选页面没有通过正文校验；另检查 ${checkedSources} 个已知来源，确认 ${verifiedSources} 个${handbookFailed ? '；社区手册接口也暂时不可用' : ''}。原有本地词库保持不变。`,
      };
    }
    if (
      previous &&
      discoveredEntries.length === 0 &&
      handbookEntries.length === 0 &&
      verifiedEntries.length === 0
    ) {
      return {
        ok: true,
        status: await this.getStatus(sourceWork),
        report,
        message: `本次同步没有找到可安全写入的新内容${searchFailed ? '；联网搜索暂时失败' : ''}。已保留原有词库，共 ${previous.entries.length} 条。`,
      };
    }
    await this.store.set(glossary.id, [...mergedEntries.values()]);
    const status = await this.getStatus(sourceWork);
    const hasLowConfidence = [...mergedEntries.values()].some((entry) => entry.confidence < 0.7);
    return {
      ok: true,
      status,
      report,
      message: `同步完成：主动搜索发现 ${discoveredEntries.length} 条，检查 ${checkedSources} 个已知来源，确认 ${verifiedSources} 个，社区手册收录 ${handbookEntries.length} 条，共缓存 ${mergedEntries.size} 条${hasLowConfidence ? '；单一来源条目按低置信度处理' : ''}${searchFailed ? '；联网搜索本次失败，已保留原有词库' : ''}${handbookFailed ? '；社区手册本次失败，已使用其他已确认来源' : ''}。`,
    };
  }

  private resolve(sourceWork: string): CuratedWorkGlossary | undefined {
    const id = resolveWorkGlossaryId(sourceWork);
    if (id) return this.catalog.find((glossary) => glossary.id === id);
    const displayName = sourceWork
      .normalize('NFKC')
      .trim()
      .replace(/^《|》$/gu, '')
      .slice(0, 120);
    if (!displayName) return undefined;
    const dynamicId = createHash('sha256')
      .update(displayName.toLowerCase(), 'utf8')
      .digest('hex')
      .slice(0, 20);
    return { id: `work-${dynamicId}`, displayName, entries: [] };
  }

  private async discoverPublicEntries(glossary: CuratedWorkGlossary): Promise<WorkGlossaryEntry[]> {
    if (!this.publicSearchUrl) return [];
    const queries = [
      `${glossary.displayName} 梗 黑话 术语 别名 社区`,
      `${glossary.displayName} 用语与梗 梗百科 经典台词 童谣`,
      `${glossary.displayName} 玩家 常用梗 名场面 二创 台词`,
      `${glossary.displayName} meme slang glossary nickname`,
    ];
    const settled = await Promise.allSettled(queries.map((query) => this.searchPublicWeb(query)));
    if (settled.every((result) => result.status === 'rejected')) {
      throw new Error('All public glossary searches failed.');
    }
    const workName = glossary.displayName.normalize('NFKC').toLowerCase();
    const candidates = new Map<string, PublicSearchItem>();
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      for (const item of result.value) {
        const haystack = `${item.title} ${item.description}`.normalize('NFKC').toLowerCase();
        if (haystack.includes(workName) && COMMUNITY_MARKER.test(haystack)) {
          candidates.set(item.url, item);
        }
      }
    }
    const fetched = await Promise.allSettled(
      [...candidates.values()].slice(0, 8).map((item) => this.fetchDiscoveredPage(item, glossary)),
    );
    const grouped = new Map<string, WorkGlossaryEntry>();
    for (const result of fetched) {
      if (result.status === 'fulfilled' && result.value) {
        const item = result.value;
        const source: WorkGlossarySource = {
          title: item.title,
          url: item.url,
          siteName: new URL(item.url).hostname,
        };
        for (const candidate of item.terms) {
          const key = normalizeTermKey(candidate.term);
          if (!key) continue;
          const previous = grouped.get(key);
          const sources = [
            ...new Map(
              [...(previous?.sources ?? []), source].map((value) => [sourceFamily(value), value]),
            ).values(),
          ];
          const aliases = [
            ...(previous?.aliases ?? []),
            ...(previous && previous.term !== candidate.term ? [candidate.term] : []),
            ...this.buildTermAliases(candidate.term),
          ];
          grouped.set(key, {
            term: previous?.term ?? candidate.term,
            aliases: [...new Set(aliases)].filter(
              (alias) => alias !== (previous?.term ?? candidate.term),
            ),
            meaning:
              candidate.description ||
              previous?.meaning ||
              `${glossary.displayName}社区使用的说法。`,
            originContext: `公开搜索发现的“${glossary.displayName}”社区说法；未经过作品官方确认，不视为设定事实。`,
            sources,
            lastVerified: Date.now(),
            confidence: sources.length >= 2 ? 0.7 : 0.45,
          });
        }
      }
    }
    return [...grouped.values()].slice(0, 300);
  }

  private async fetchDiscoveredPage(
    item: PublicSearchItem,
    glossary: CuratedWorkGlossary,
  ): Promise<DiscoveredPage | undefined> {
    const url = new URL(item.url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetcher(url.toString(), {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: { accept: 'text/html, text/plain;q=0.9', 'user-agent': USER_AGENT },
      });
      if (!response.ok) return undefined;
      if (response.url && new URL(response.url).origin !== url.origin) return undefined;
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > MAX_SEARCH_RESPONSE_CHARACTERS) return undefined;
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (
        contentType &&
        !contentType.includes('text/html') &&
        !contentType.includes('text/plain')
      ) {
        return undefined;
      }
      const body = await response.text();
      if (body.length > MAX_SEARCH_RESPONSE_CHARACTERS) return undefined;
      const text = this.decodeRssText(body).slice(0, 500_000);
      const normalized = text.normalize('NFKC').toLowerCase();
      const workName = glossary.displayName.normalize('NFKC').toLowerCase();
      if (!normalized.includes(workName) || !COMMUNITY_MARKER.test(normalized)) {
        return undefined;
      }
      const terms = this.extractDiscoveredTerms(body, item.title, glossary.displayName).flatMap(
        (term) => {
          const focus = normalized.indexOf(term.normalize('NFKC').toLowerCase());
          if (focus < 0) return [];
          const description = this.extractTermDescription(text, focus, term.length);
          return description.length >= 20 ? [{ term, description }] : [];
        },
      );
      return terms.length > 0 ? { ...item, terms } : undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async searchPublicWeb(query: string): Promise<PublicSearchItem[]> {
    if (!this.publicSearchUrl) return [];
    const searchUrl = new URL(this.publicSearchUrl);
    searchUrl.search = new URLSearchParams({ q: query }).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetcher(searchUrl.toString(), {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          accept: 'text/html, application/rss+xml, application/xml;q=0.9',
          'user-agent': USER_AGENT,
        },
      });
      if (!response.ok) throw new Error('The public glossary search is unavailable.');
      if (response.url && new URL(response.url).origin !== searchUrl.origin) {
        throw new Error('The public glossary search origin is invalid.');
      }
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > MAX_SEARCH_RESPONSE_CHARACTERS)
        throw new Error('Search response too large.');
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (
        contentType &&
        !contentType.includes('text/html') &&
        !contentType.includes('xml') &&
        !contentType.includes('text/plain')
      ) {
        throw new Error('Search response type is invalid.');
      }
      const body = await response.text();
      if (body.length > MAX_SEARCH_RESPONSE_CHARACTERS)
        throw new Error('Search response too large.');
      const allowLoopback = ['127.0.0.1', 'localhost', '[::1]'].includes(searchUrl.hostname);
      if (contentType.includes('text/html')) {
        return this.parseDuckDuckGoResults(body, allowLoopback);
      }
      return [...body.matchAll(/<item>([\s\S]*?)<\/item>/giu)].flatMap((match) => {
        const item = match[1] ?? '';
        const title = this.decodeRssText(this.readRssTag(item, 'title')).slice(0, 300);
        const description = this.decodeRssText(this.readRssTag(item, 'description')).slice(0, 700);
        const url = this.allowedSearchResultUrl(this.readRssTag(item, 'link'), allowLoopback);
        return title && url ? [{ title, url: url.toString(), description }] : [];
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseDuckDuckGoResults(body: string, allowLoopback: boolean): PublicSearchItem[] {
    return [
      ...body.matchAll(
        /<div\s+class="result\s+results_links[\s\S]*?<div\s+class="clear"><\/div>/giu,
      ),
    ]
      .flatMap((match) => {
        const block = match[0];
        const link = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/iu.exec(block);
        if (!link) return [];
        const target = this.unwrapSearchResultUrl(link[1] ?? '', allowLoopback);
        if (!target) return [];
        const title = this.decodeRssText(link[2] ?? '').slice(0, 300);
        const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/iu.exec(block)?.[1] ?? '';
        const description = this.decodeRssText(snippet).slice(0, 700);
        return title ? [{ title, url: target.toString(), description }] : [];
      })
      .slice(0, 15);
  }

  private unwrapSearchResultUrl(value: string, allowLoopback: boolean): URL | undefined {
    try {
      const decoded = value.replaceAll('&amp;', '&');
      const redirect = new URL(decoded, 'https://duckduckgo.com');
      const target =
        (redirect.hostname === 'duckduckgo.com' || redirect.hostname.endsWith('.duckduckgo.com')) &&
        redirect.pathname === '/l/'
          ? redirect.searchParams.get('uddg')
          : redirect.toString();
      return target ? this.allowedSearchResultUrl(target, allowLoopback) : undefined;
    } catch {
      return undefined;
    }
  }

  private extractDiscoveredTerm(title: string, workName: string): string | undefined {
    const quoted = /[“「『《"]([^”」』》"]{1,80})[”」』》"]/.exec(title)?.[1]?.trim();
    const leadingTitle = title.split(/\s[-_|｜]\s/u)[0] ?? '';
    if (
      !quoted &&
      /(?:用语与梗|梗及用语|梗百科|社区用语|meme\s+list|glossary)/iu.test(leadingTitle)
    ) {
      return undefined;
    }
    const candidate = (quoted ?? leadingTitle)
      .replace(new RegExp(workName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), ' ')
      .replace(
        /(?:是什么|什么意思|怎么回事|梗百科|社区|玩家)?(?:梗|黑话|黑称|术语|别名|外号|昵称|meme|slang|glossary).*/giu,
        ' ',
      )
      .replace(/[？?：:｜|【】()（）]|\[|\]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!candidate || candidate.length > 80 || COMMUNITY_MARKER.test(candidate)) return undefined;
    return candidate;
  }

  private extractDiscoveredTerms(body: string, title: string, workName: string): string[] {
    const candidates: string[] = [];
    const titleTerm = this.extractDiscoveredTerm(title, workName);
    if (titleTerm) candidates.push(titleTerm);
    for (const match of body.matchAll(/<h[2-5]\b[^>]*>([\s\S]*?)<\/h[2-5]>/giu)) {
      if (match.index === undefined) continue;
      const nearby = this.decodeRssText(body.slice(match.index, match.index + 2_000));
      if (COMMUNITY_MARKER.test(nearby)) candidates.push(this.decodeRssText(match[1] ?? ''));
    }
    const plainText = this.decodeRssText(body).slice(0, 100_000);
    for (const match of plainText.matchAll(/[“「『"]([^”」』"]{2,60})[”」』"]/gu)) {
      const phrase = match[1]?.trim();
      if (!phrase || match.index === undefined) continue;
      const context = plainText.slice(
        Math.max(0, match.index - 100),
        match.index + phrase.length + 140,
      );
      if (COMMUNITY_MARKER.test(context)) candidates.push(phrase);
    }
    return [...new Map(candidates.map((value) => [normalizeTermKey(value), value])).values()]
      .flatMap((value) => {
        const term = this.cleanExtractedTerm(value, workName);
        return term ? [term] : [];
      })
      .slice(0, 300);
  }

  private cleanExtractedTerm(value: string, workName: string): string | undefined {
    const term = value
      .replace(/\[(?:编辑|edit)\]|\((?:编辑|edit)\)/giu, ' ')
      .replace(/^\s*(?:\d+[.)、]|[一二三四五六七八九十]+[、.])\s*/u, '')
      .replace(/^[“「『"]|[”」』"]$/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    const normalized = normalizeTermKey(term);
    const normalizedWork = normalizeTermKey(workName);
    if (
      !normalized ||
      normalized.length < 2 ||
      term.length > 60 ||
      normalized === normalizedWork ||
      /^(?:用语与梗|梗及用语|梗百科|社区用语|角色相关|剧情相关|其他|杂项|简介|概述|背景|目录|参见|参考资料|注释|外部链接)$/u.test(
        term,
      )
    ) {
      return undefined;
    }
    return term;
  }

  private extractTermDescription(text: string, focus: number, termLength: number): string {
    const preceding = Math.max(
      text.lastIndexOf('。', focus - 1),
      text.lastIndexOf('\n', focus - 1),
    );
    const followingStops = [
      text.indexOf('。', focus + termLength),
      text.indexOf('\n', focus + termLength),
    ].filter((position) => position >= 0);
    const following = followingStops.length > 0 ? Math.min(...followingStops) + 1 : text.length;
    return text
      .slice(Math.max(preceding + 1, focus - 100), Math.min(following, focus + termLength + 220))
      .trim()
      .slice(0, 700);
  }

  private buildTermAliases(term: string): string[] {
    const compact = term.replace(/[^\p{L}\p{N}]+/gu, '');
    const particleVariant = /啦$/u.test(compact)
      ? compact.replace(/啦$/u, '了')
      : /了$/u.test(compact)
        ? compact.replace(/了$/u, '啦')
        : '';
    return [...new Set([compact, particleVariant].filter((value) => value && value !== term))];
  }

  private readRssTag(item: string, tag: string): string {
    const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'iu').exec(item);
    return match?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() ?? '';
  }

  private decodeRssText(value: string): string {
    return value
      .replace(/<[^>]*>/g, ' ')
      .replaceAll('&quot;', '"')
      .replaceAll('&#039;', "'")
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private allowedSearchResultUrl(value: string, allowLoopback: boolean): URL | undefined {
    try {
      const url = new URL(value.replaceAll('&amp;', '&'));
      const loopback =
        allowLoopback &&
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      if (
        (!loopback && url.protocol !== 'https:') ||
        url.username ||
        url.password ||
        (!loopback &&
          !SEARCH_RESULT_HOSTS.some(
            (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
          ))
      ) {
        return undefined;
      }
      url.hash = '';
      return url;
    } catch {
      return undefined;
    }
  }

  private async crawlHandbook(): Promise<WorkGlossaryEntry[]> {
    if (!this.handbookApiUrl) return [];
    const titles: string[] = [];
    let continuation = '';
    do {
      const url = new URL(this.handbookApiUrl);
      url.search = new URLSearchParams({
        action: 'query',
        list: 'allpages',
        apnamespace: '0',
        aplimit: '500',
        format: 'json',
        formatversion: '2',
        origin: '*',
        ...(continuation ? { apcontinue: continuation } : {}),
      }).toString();
      const data = await this.fetchJson(url.toString());
      const query = this.asRecord(data.query);
      const pages = Array.isArray(query?.allpages) ? query.allpages : [];
      for (const page of pages) {
        const record = this.asRecord(page);
        if (typeof record?.title === 'string') titles.push(record.title);
      }
      const next = this.asRecord(data.continue)?.apcontinue;
      continuation = typeof next === 'string' ? next : '';
    } while (continuation && titles.length < 2_000);

    const entries: WorkGlossaryEntry[] = [];
    for (let index = 0; index < titles.length; index += 25) {
      const url = new URL(this.handbookApiUrl);
      url.search = new URLSearchParams({
        action: 'query',
        prop: 'revisions|info',
        titles: titles.slice(index, index + 25).join('|'),
        redirects: '1',
        rvprop: 'timestamp|content',
        rvslots: 'main',
        inprop: 'url',
        format: 'json',
        formatversion: '2',
        origin: '*',
      }).toString();
      const data = await this.fetchJson(url.toString());
      const query = this.asRecord(data.query);
      const redirects = Array.isArray(query?.redirects) ? query.redirects : [];
      const aliases = new Map<string, string[]>();
      for (const redirect of redirects) {
        const record = this.asRecord(redirect);
        if (typeof record?.from === 'string' && typeof record.to === 'string') {
          aliases.set(record.to, [...(aliases.get(record.to) ?? []), record.from]);
        }
      }
      const pages = Array.isArray(query?.pages) ? (query.pages as HandbookPage[]) : [];
      for (const page of pages) {
        const content = page.revisions?.[0]?.slots?.main?.content;
        const meaning = content ? this.toPlainText(content) : '';
        if (!meaning || !page.fullurl) continue;
        const timestamp = Date.parse(page.revisions?.[0]?.timestamp ?? '');
        const shortTitle = page.title.replace(/\s*\((?:黑话|黑称|梗)\)\s*$/, '');
        entries.push({
          term: page.title,
          aliases: [
            ...(aliases.get(page.title) ?? []),
            ...(shortTitle !== page.title ? [shortTitle] : []),
          ],
          meaning,
          originContext: `粥批手册“${page.title}”条目的社区说明；属于玩家整理内容，不视为作品内事实。`,
          sources: [{ title: page.title, url: page.fullurl, siteName: '粥批手册' }],
          lastVerified: Number.isFinite(timestamp) ? timestamp : Date.now(),
          confidence: 0.62,
        });
      }
    }
    return entries;
  }

  private async fetchJson(url: string): Promise<Record<string, unknown>> {
    const response = await this.fetcher(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error('The handbook API is unavailable.');
    const parsed = (await response.json()) as unknown;
    const record = this.asRecord(parsed);
    if (!record) throw new Error('The handbook API response is invalid.');
    return record;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private toPlainText(wikitext: string): string {
    let text = wikitext.replace(/\{\|[\s\S]*?\|\}/g, ' ');
    for (let pass = 0; pass < 4; pass += 1) text = text.replace(/\{\{[^{}]*\}\}/g, ' ');
    return text
      .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>|<ref\b[^/]*\/>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\[\[(?:File|文件|Category|分类):[^\]]+\]\]/gi, ' ')
      .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/={2,}([^=]+)={2,}/g, ' $1 ')
      .replace(/'{2,}/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 700);
  }

  private async verifySource(
    source: WorkGlossarySource,
    evidence: readonly string[],
  ): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.fetcher(source.url, {
        method: 'GET',
        signal: controller.signal,
        headers: { accept: 'text/html, text/plain;q=0.9' },
      });
      if (!response.ok) return false;
      const body = (await response.text()).normalize('NFKC').toLowerCase().slice(0, 1_000_000);
      return evidence.every((item) => body.includes(item.normalize('NFKC').toLowerCase()));
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
