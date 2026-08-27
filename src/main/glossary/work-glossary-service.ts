import {
  findRelevantGlossaryEntries,
  resolveWorkGlossaryId,
  type WorkGlossaryEntry,
  type WorkGlossarySource,
} from '../../core/conversation/work-glossary';
import type { WorkGlossaryStatus, WorkGlossarySyncResult } from '../../shared/work-glossary-ipc';
import { WorkGlossaryStore } from '../storage/work-glossary-store';
import { CURATED_WORK_GLOSSARIES, type CuratedWorkGlossary } from './curated-work-glossaries';

type GlossaryFetch = (input: string, init?: RequestInit) => Promise<Response>;
const AKP_HANDBOOK_API = 'https://akp.fandom.com/zh/api.php';

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
  ) {
    this.store = new WorkGlossaryStore(userDataPath);
  }

  public async findMatches(sourceWork: string, message: string): Promise<WorkGlossaryEntry[]> {
    try {
      const glossary = this.resolve(sourceWork);
      if (!glossary) return [];
      const cached = await this.store.get(glossary.id);
      return findRelevantGlossaryEntries(message, cached?.entries ?? glossary.entries);
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
    if (!glossary) return { ok: false, message: '当前作品还没有可同步的社区词库。' };
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
    for (const entry of handbookEntries) mergedEntries.set(entry.term.normalize('NFKC'), entry);
    for (const entry of verifiedEntries) mergedEntries.set(entry.term.normalize('NFKC'), entry);
    const report = {
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
        message: `同步未写入缓存：检查 ${checkedSources} 个来源，确认 ${verifiedSources} 个${handbookFailed ? '；社区手册接口也暂时不可用' : ''}。原有本地词库保持不变。`,
      };
    }
    await this.store.set(glossary.id, [...mergedEntries.values()]);
    const status = await this.getStatus(sourceWork);
    const hasLowConfidence = [...mergedEntries.values()].some((entry) => entry.confidence < 0.7);
    return {
      ok: true,
      status,
      report,
      message: `同步完成：检查 ${checkedSources} 个来源，确认 ${verifiedSources} 个，社区手册收录 ${handbookEntries.length} 条，共缓存 ${mergedEntries.size} 条${hasLowConfidence ? '；单一来源条目按低置信度处理' : ''}${handbookFailed ? '；社区手册本次失败，已使用其他已确认来源' : ''}。`,
    };
  }

  private resolve(sourceWork: string): CuratedWorkGlossary | undefined {
    const id = resolveWorkGlossaryId(sourceWork);
    return id ? this.catalog.find((glossary) => glossary.id === id) : undefined;
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
