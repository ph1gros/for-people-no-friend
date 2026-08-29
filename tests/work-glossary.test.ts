import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildWorkGlossaryQueries,
  findRelevantGlossaryEntries,
  findRelevantGlossaryEntriesForContext,
  formatWorkGlossaryContext,
  resolveWorkGlossaryId,
  type WorkGlossaryEntry,
  validateWorkGlossaryEntry,
} from '../src/core/conversation/work-glossary';
import type { CuratedWorkGlossary } from '../src/main/glossary/curated-work-glossaries';
import { WorkGlossaryService } from '../src/main/glossary/work-glossary-service';
import { startFakeHttpServer, type FakeHttpServer } from './helpers/fake-http-server';

const entry: WorkGlossaryEntry = {
  term: '325',
  aliases: ['325大学习', '1周'],
  meaning: '方舟社区的低分梗。',
  originContext: '来自仙术杯第五届魔法Zc目录的局内结算分。',
  sources: [],
  lastVerified: 1,
  confidence: 0.93,
};

describe('work-specific community glossary', () => {
  let directory: string | undefined;
  let server: FakeHttpServer | undefined;

  afterEach(async () => {
    if (server) await server.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    server = undefined;
    directory = undefined;
  });

  it('resolves the character work and precisely matches numbers and aliases', () => {
    expect(resolveWorkGlossaryId('《明日方舟》')).toBe('arknights');
    expect(resolveWorkGlossaryId('Arknights')).toBe('arknights');
    expect(resolveWorkGlossaryId('三角洲')).toBe('delta-force');
    expect(resolveWorkGlossaryId('Delta Force')).toBe('delta-force');
    expect(findRelevantGlossaryEntries('325是什么？', [entry])).toEqual([entry]);
    expect(findRelevantGlossaryEntries('今天完成325大学习', [entry])).toEqual([entry]);
    expect(findRelevantGlossaryEntries('1325是什么？', [entry])).toEqual([]);
    expect(findRelevantGlossaryEntries('方舟社区那个低分梗是什么？', [entry])).toEqual([entry]);
  });

  it('recognizes curated Delta Force community memes and distinguishes the Luna parody', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-delta-glossary-'));
    const service = new WorkGlossaryService(directory, async () => {
      throw new Error('The curated lookup must not use the network.');
    });

    await expect(service.findMatches('三角洲', '787878是什么意思')).resolves.toEqual([
      expect.objectContaining({ term: '78主播', aliases: expect.arrayContaining(['787878']) }),
    ]);
    await expect(service.findMatches('三角洲行动', '头甲枪胸挂背包，花来！')).resolves.toEqual([
      expect.objectContaining({ term: '花来' }),
    ]);
    await expect(service.findMatches('Delta Force', '我的箭下全是秘密')).resolves.toEqual([
      expect.objectContaining({
        term: '我的箭下全是秘密',
        meaning: expect.stringContaining('“我的箭下没有秘密”反转'),
      }),
    ]);
  });

  it('expands an ambiguous follow-up with bounded recent context', () => {
    expect(
      buildWorkGlossaryQueries({
        message: '这个又是什么意思？',
        recentMessages: ['先不聊天气', '我刚看到“325大学习”'],
      }),
    ).toEqual(['这个又是什么意思？', '我刚看到“325大学习” 这个又是什么意思？']);
    expect(
      findRelevantGlossaryEntriesForContext(
        {
          message: '这个又是什么意思？',
          recentMessages: ['我刚看到“325大学习”'],
        },
        [entry],
      ),
    ).toEqual([entry]);
  });

  it('uses deterministic RRF ordering and follows at most two explicit term relations', () => {
    const entries: WorkGlossaryEntry[] = [
      entry,
      {
        ...entry,
        term: '仙术杯',
        aliases: [],
        meaning: '明日方舟集成战略的社区赛事，相关讨论里也会提到魔法Zc目录。',
        originContext: '社区赛事资料。',
        confidence: 0.9,
      },
      {
        ...entry,
        term: '魔法Zc目录',
        aliases: ['目录'],
        meaning: '参加仙术杯的选手。',
        originContext: '社区赛事资料。',
        confidence: 0.88,
      },
      {
        ...entry,
        term: '无关词条',
        aliases: [],
        meaning: '不会被关联的另一条资料。',
        originContext: '其他语境。',
        confidence: 1,
      },
    ];
    expect(
      findRelevantGlossaryEntriesForContext({ message: '325是什么梗？' }, entries, 3, 2).map(
        ({ term }) => term,
      ),
    ).toEqual(['325', '仙术杯', '魔法Zc目录']);
  });

  it('rejects unsafe glossary sources and ignores a damaged cache', async () => {
    expect(() =>
      validateWorkGlossaryEntry({
        ...entry,
        sources: [{ title: '不安全', siteName: '测试', url: 'http://example.com/source' }],
      }),
    ).toThrow('invalid');

    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-glossary-damaged-'));
    const cacheDirectory = path.join(directory, 'work-glossaries');
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(
      path.join(cacheDirectory, 'arknights.v1.json'),
      JSON.stringify({ version: 1, workId: 'arknights', syncedAt: 1, entries: [{ bad: true }] }),
      'utf8',
    );
    const catalog: CuratedWorkGlossary[] = [
      { id: 'arknights', displayName: '明日方舟', entries: [{ ...entry, evidence: ['325'] }] },
    ];
    const service = new WorkGlossaryService(directory, fetch, catalog, '', '', null);
    expect(await service.findMatches('明日方舟', '325是什么？')).toEqual([entry]);
  });

  it('formats matched entries as community context rather than canon', () => {
    const context = formatWorkGlossaryContext([entry]);
    expect(context).toContain('玩家社区语境，不是角色世界观事实');
    expect(context).toContain('如果你指社区里说的');
    expect(context).toContain('325');
  });

  it('syncs only after multiple fake HTTP sources confirm the evidence', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-glossary-test-'));
    server = await startFakeHttpServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<html>仙术杯 魔法Zc目录 局内结算 325 分</html>');
    });
    const sources = ['/first', '/second'].map((suffix, index) => ({
      title: `来源${index + 1}`,
      url: `${server?.baseUrl}${suffix}`,
      siteName: `测试站点${index + 1}`,
    }));
    const catalog: CuratedWorkGlossary[] = [
      {
        id: 'arknights',
        displayName: '明日方舟',
        entries: [{ ...entry, sources, evidence: ['325', '魔法zc目录'] }],
      },
    ];
    const service = new WorkGlossaryService(directory, fetch, catalog, '', '', null);
    const result = await service.sync('明日方舟');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report).toMatchObject({
      checkedSources: 2,
      verifiedSources: 2,
      cachedEntries: 1,
    });
    expect(result.status.lastSynced).toBeTypeOf('number');
    expect(result.status.sources).toHaveLength(2);
    expect((await service.findMatches('明日方舟', '325是什么'))[0]).toMatchObject({
      term: '325',
      confidence: 0.93,
    });
  });

  it('reports unreachable sources while preserving the curated fallback in the cache', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-glossary-failure-'));
    server = await startFakeHttpServer((_request, response) => {
      response.statusCode = 503;
      response.end('unavailable');
    });
    const catalog: CuratedWorkGlossary[] = [
      {
        id: 'arknights',
        displayName: '明日方舟',
        entries: [
          {
            ...entry,
            sources: [{ title: '暂时失败的来源', siteName: '测试站点', url: server.baseUrl }],
            evidence: ['325'],
          },
        ],
      },
    ];
    const service = new WorkGlossaryService(directory, fetch, catalog, '', '', null);
    const result = await service.sync('明日方舟');
    expect(result).toMatchObject({
      ok: true,
      report: {
        checkedSources: 1,
        verifiedSources: 0,
        failedSourceTitles: ['暂时失败的来源'],
        cachedEntries: 1,
      },
    });
    expect(result.message).toContain('当前网络不可达');
    expect(result.message).toContain('不表示已有校对内容失效');
    expect(await service.getStatus('明日方舟')).toMatchObject({
      cacheOrigin: 'synced',
      entryCount: 1,
    });
  });

  it('traverses handbook pages and indexes redirect aliases during explicit sync', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-handbook-test-'));
    server = await startFakeHttpServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      response.setHeader('content-type', 'application/json; charset=utf-8');
      if (url.pathname === '/api.php' && url.searchParams.get('list') === 'allpages') {
        response.end(
          JSON.stringify({
            batchcomplete: true,
            query: { allpages: [{ pageid: 1, ns: 0, title: '尾巴吧吧犬人' }] },
          }),
        );
        return;
      }
      if (url.pathname === '/api.php' && url.searchParams.get('prop')) {
        response.end(
          JSON.stringify({
            batchcomplete: true,
            query: {
              redirects: [{ from: '尾巴犬人', to: '尾巴吧吧犬人' }],
              pages: [
                {
                  pageid: 1,
                  ns: 0,
                  title: '尾巴吧吧犬人',
                  fullurl: `${server?.baseUrl}/wiki/tail`,
                  revisions: [
                    {
                      timestamp: '2026-08-20T00:00:00Z',
                      slots: {
                        main: { content: "'''尾巴吧吧犬人'''是方舟社区使用的外号说明。" },
                      },
                    },
                  ],
                },
              ],
            },
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'not found' }));
    });
    const catalog: CuratedWorkGlossary[] = [
      { id: 'arknights', displayName: '明日方舟', entries: [] },
    ];
    const service = new WorkGlossaryService(
      directory,
      fetch,
      catalog,
      `${server.baseUrl}/api.php`,
      '',
      null,
    );
    const result = await service.sync('明日方舟');
    expect(result.ok).toBe(true);
    expect(await service.findMatches('明日方舟', '尾巴犬人是什么？')).toEqual([
      expect.objectContaining({
        term: '尾巴吧吧犬人',
        aliases: ['尾巴犬人'],
        confidence: 0.62,
      }),
    ]);
  });

  it('actively searches and creates an isolated glossary for a previously unknown work', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-glossary-discovery-'));
    server = await startFakeHttpServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/first' || url.pathname === '/second') {
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end('<article>原神社区梗资料：牛杂师傅是玩家用于调侃刻晴的外号。</article>');
        return;
      }
      if (url.pathname !== '/search') {
        response.statusCode = 404;
        response.end('not found');
        return;
      }
      response.setHeader('content-type', 'application/rss+xml; charset=utf-8');
      response.end(`<?xml version="1.0"?><rss><channel>
        <item><title>“牛杂师傅”是什么梗？原神社区</title><link>${server?.baseUrl}/first</link><description>原神玩家用于调侃刻晴的社区外号和梗。</description></item>
        <item><title>原神玩家称“牛杂师傅”的由来</title><link>${server?.baseUrl}/second</link><description>原神社区对牛杂师傅这个昵称的解释。</description></item>
      </channel></rss>`);
    });
    const service = new WorkGlossaryService(
      directory,
      fetch,
      [],
      '',
      `${server.baseUrl}/search`,
      null,
    );

    expect(await service.getStatus('原神')).toMatchObject({
      supported: true,
      workName: '原神',
      entryCount: 0,
    });
    const result = await service.sync('原神');
    expect(result).toMatchObject({
      ok: true,
      report: {
        searchedQueries: 5,
        discoveredEntries: 1,
        searchFailed: false,
      },
    });
    expect(await service.findMatches('原神', '牛杂师傅是什么梗？')).toEqual([
      expect.objectContaining({
        term: '牛杂师傅',
        confidence: 0.7,
        sources: expect.arrayContaining([
          expect.objectContaining({ url: `${server.baseUrl}/first` }),
          expect.objectContaining({ url: `${server.baseUrl}/second` }),
        ]),
      }),
    ]);
    expect((await service.getStatus('明日方舟')).entryCount).toBe(0);
  });

  it('keeps an existing cache when every later public search fails', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-glossary-search-fallback-'));
    let failSearch = false;
    server = await startFakeHttpServer((request, response) => {
      if (failSearch) {
        response.statusCode = 503;
        response.end('unavailable');
        return;
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/entry') {
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end('<article>原神社区外号与梗：牛杂师傅用于调侃刻晴。</article>');
        return;
      }
      response.setHeader('content-type', 'application/rss+xml; charset=utf-8');
      response.end(`<?xml version="1.0"?><rss><channel>
        <item><title>“牛杂师傅”是什么梗？原神社区</title><link>${server?.baseUrl}/entry</link><description>原神玩家使用的社区外号和梗。</description></item>
      </channel></rss>`);
    });
    const service = new WorkGlossaryService(
      directory,
      fetch,
      [],
      '',
      `${server.baseUrl}/search`,
      null,
    );
    expect((await service.sync('原神')).ok).toBe(true);
    failSearch = true;

    const second = await service.sync('原神');
    expect(second).toMatchObject({
      ok: true,
      report: { searchFailed: true, discoveredEntries: 0, cachedEntries: 1 },
    });
    expect(second.message).toContain('已保留内置或原有词库');
    expect(await service.findMatches('原神', '牛杂师傅')).toHaveLength(1);
  });

  it('uses a second public search provider when the first provider is unavailable', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-glossary-search-redundancy-'));
    server = await startFakeHttpServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/primary') {
        response.statusCode = 503;
        response.end('unavailable');
        return;
      }
      if (url.pathname === '/entry') {
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end(
          '<main><h1>原神社区梗百科</h1><h3>云玩家</h3><p>云玩家是原神社区使用的称呼和梗。</p></main>',
        );
        return;
      }
      response.setHeader('content-type', 'application/rss+xml; charset=utf-8');
      response.end(`<?xml version="1.0"?><rss><channel>
        <item><title>原神梗百科 - 社区 Wiki</title><link>${server?.baseUrl}/entry</link><description>原神社区黑话、术语和梗合集。</description></item>
      </channel></rss>`);
    });
    const service = new WorkGlossaryService(
      directory,
      fetch,
      [],
      '',
      `${server.baseUrl}/primary`,
      null,
      `${server.baseUrl}/secondary?format=rss`,
    );

    const result = await service.sync('原神');
    expect(result).toMatchObject({
      ok: true,
      report: { searchedQueries: 5, discoveredEntries: 1, searchFailed: false },
    });
    await expect(service.findMatches('原神', '云玩家是什么意思')).resolves.toEqual([
      expect.objectContaining({ term: '云玩家' }),
    ]);
  });

  it('discovers community terms through the regional wiki before public search fallback', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-glossary-regional-wiki-'));
    const searchQueries: string[] = [];
    server = await startFakeHttpServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/api.php') {
        response.setHeader('content-type', 'application/json; charset=utf-8');
        if (url.searchParams.get('prop')) {
          response.end(
            JSON.stringify({
              query: {
                pages: [
                  {
                    pageid: 1,
                    title: '三角洲行动/梗',
                    fullurl: `${server?.baseUrl}/三角洲行动/梗`,
                    extract:
                      '本页面收录游戏三角洲行动的相关黑话、用语与梗。\n\n常见用语\n牢大：三角洲玩家社区流传的称呼和黑话梗，用于特定玩法语境。',
                  },
                ],
              },
            }),
          );
          return;
        }
        const query = url.searchParams.get('srsearch') ?? '';
        searchQueries.push(query);
        response.end(
          JSON.stringify({
            query: {
              search:
                query === '三角洲'
                  ? [
                      {
                        pageid: 1,
                        title: '三角洲行动/梗',
                        snippet: '三角洲行动玩家使用的社区黑话与梗。',
                      },
                    ]
                  : [],
            },
          }),
        );
        return;
      }
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(
        '<main><h1>三角洲社区用语与梗</h1><h3>牢大</h3><p>“牢大”是三角洲玩家社区流传的称呼和黑话梗，用于特定玩法语境。</p></main>',
      );
    });
    const service = new WorkGlossaryService(
      directory,
      fetch,
      [],
      '',
      '',
      `${server.baseUrl}/api.php`,
    );

    const result = await service.sync('三角洲');
    expect(result).toMatchObject({
      ok: true,
      report: { searchFailed: false, discoveredEntries: 1, cachedEntries: 1 },
    });
    expect(searchQueries).toContain('三角洲');
    expect(searchQueries).not.toContain('三角洲 梗 黑话 术语 别名 社区');
    expect(await service.findMatches('三角洲', '牢大是什么意思')).toEqual([
      expect.objectContaining({ term: '牢大', confidence: 0.45 }),
    ]);
  });

  it('checks an exact regional work page even when its search snippet has no glossary marker', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-glossary-exact-work-page-'));
    server = await startFakeHttpServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      response.setHeader('content-type', 'application/json; charset=utf-8');
      if (url.searchParams.get('prop')) {
        response.end(
          JSON.stringify({
            query: {
              pages: [
                {
                  pageid: 1,
                  title: '缘之空',
                  fullurl: `${server?.baseUrl}/缘之空`,
                  extract:
                    '<p>《缘之空》是恋爱冒险游戏。</p><ul><li>缘什么空，什么之空，缘之什么：衍生自“马冬梅”的社区梗，用于调侃作品相关场景。</li><li>死去万事：同一段社区梗中的谐音说法。</li></ul><h3>制作人员</h3><p>原画：桥本负责人物作画，属于普通制作人员信息。</p>',
                },
              ],
            },
          }),
        );
        return;
      }
      response.end(
        JSON.stringify({
          query: {
            search: [
              {
                pageid: 1,
                title: '缘之空',
                snippet: '《缘之空》是由 Sphere 制作的恋爱冒险游戏。',
              },
            ],
          },
        }),
      );
    });
    const service = new WorkGlossaryService(
      directory,
      fetch,
      [],
      '',
      '',
      `${server.baseUrl}/api.php`,
    );

    const result = await service.sync('缘之空');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.discoveredEntries).toBeGreaterThan(0);
    expect(result.report.cachedEntries).toBeGreaterThan(0);
    expect(await service.findMatches('缘之空', '原画是谁')).toEqual([]);
    await expect(service.findMatches('缘之空', '缘什么空是什么梗')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ term: '缘什么空，什么之空，缘之什么' })]),
    );
  });

  it('deep-scans exact work references for related buzzword pages on every sync', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-glossary-buzzword-sweep-'));
    const searchQueries: Array<{ query: string; limit: string }> = [];
    const fetchedTitles: string[] = [];
    server = await startFakeHttpServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      response.setHeader('content-type', 'application/json; charset=utf-8');
      if (url.searchParams.get('prop')) {
        const title = url.searchParams.get('titles') ?? '';
        fetchedTitles.push(title);
        const extract =
          title === '德国骨科'
            ? '德国骨科成为中文网络中指代兄弟姐妹恋爱题材的代名词。2024年《缘之空》开发商提到从中国用户处知道了“骨科”这个梗。'
            : '《缘之空》是恋爱冒险游戏，社区梗资料可另行查阅。';
        response.end(
          JSON.stringify({
            query: {
              pages: [
                {
                  pageid: 1,
                  title,
                  fullurl: `${server?.baseUrl}/${encodeURIComponent(title)}`,
                  extract,
                },
              ],
            },
          }),
        );
        return;
      }
      const query = url.searchParams.get('srsearch') ?? '';
      searchQueries.push({ query, limit: url.searchParams.get('srlimit') ?? '' });
      response.end(
        JSON.stringify({
          query: {
            search:
              query === '缘之空'
                ? [{ pageid: 1, title: '缘之空', snippet: '《缘之空》是恋爱冒险游戏。' }]
                : query === '"缘之空"'
                  ? [
                      {
                        pageid: 2,
                        title: '德国骨科',
                        snippet:
                          '《<span class="searchmatch">缘</span><span class="searchmatch">之</span><span class="searchmatch">空</span>》开发商提到从中国用户处知道了“骨科”这个梗。',
                      },
                      {
                        pageid: 3,
                        title: 'Feel.',
                        snippet: '动画制作公司，别名フィール，主要作品包括《缘之空》。',
                      },
                    ]
                  : [],
          },
        }),
      );
    });
    const service = new WorkGlossaryService(
      directory,
      fetch,
      [],
      '',
      '',
      `${server.baseUrl}/api.php`,
    );

    const result = await service.sync('缘之空');

    expect(result).toMatchObject({
      ok: true,
      report: { searchedQueries: 5, discoveredEntries: 1, cachedEntries: 1 },
    });
    expect(searchQueries).toContainEqual({ query: '"缘之空"', limit: '50' });
    expect(fetchedTitles).toContain('德国骨科');
    expect(fetchedTitles).not.toContain('Feel.');
    await expect(service.findMatches('缘之空', '德国骨科是什么意思')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ term: '德国骨科', confidence: 0.45 })]),
    );
  });

  it('refreshes a registered work glossary directly from its online community source', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-glossary-online-source-'));
    server = await startFakeHttpServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      expect(url.pathname).toBe('/api.php');
      expect(url.searchParams.get('titles')).toBe('三角洲行动/梗');
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(
        JSON.stringify({
          query: {
            pages: [
              {
                pageid: 1,
                title: '三角洲行动/梗',
                fullurl: `${server?.baseUrl}/三角洲行动/梗`,
                extract:
                  '<h4>云端新梗</h4><p>云端新梗是三角洲行动玩家社区新收录的黑话，用于验证在线词库刷新。</p>',
              },
            ],
          },
        }),
      );
    });
    const catalog: CuratedWorkGlossary[] = [
      {
        id: 'delta-force',
        displayName: '三角洲行动',
        entries: [],
        onlineSources: [
          {
            title: '三角洲行动/梗',
            pageUrl: `${server.baseUrl}/三角洲行动/梗`,
            mediaWikiApiUrl: `${server.baseUrl}/api.php`,
            mediaWikiTitle: '三角洲行动/梗',
          },
        ],
      },
    ];
    const service = new WorkGlossaryService(directory, fetch, catalog, '', '', null);

    const result = await service.sync('三角洲');
    expect(result).toMatchObject({
      ok: true,
      report: { searchedQueries: 0, discoveredEntries: 1, cachedEntries: 1 },
    });
    await expect(service.findMatches('三角洲', '云端新梗是什么意思')).resolves.toEqual([
      expect.objectContaining({ term: '云端新梗' }),
    ]);
  });

  it('extracts meme phrases from a glossary collection page instead of requiring one page per term', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-glossary-collection-'));
    server = await startFakeHttpServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/collection') {
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end(`<main>
          <h1>原神用语与梗</h1>
          <h3>原神，启动！</h3><p>这是原神玩家社区流传的口号梗。</p>
          <p>玩家也会把“哒哒哒哒哒，好想玩原神”当作二创梗使用。</p>
          <p>台词“水龙，水龙，别哭啦”后来也成为原神社区迷因。</p>
        </main>`);
        return;
      }
      response.setHeader('content-type', 'text/html; charset=utf-8');
      const target = encodeURIComponent(`${server?.baseUrl}/collection`);
      response.end(`<div class="result results_links results_links_deep web-result">
        <div class="links_main result__body">
          <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=${target}&amp;rut=fake">原神/用语与梗 - 社区百科</a></h2>
          <a class="result__snippet">原神社区梗、童谣和经典台词合集。</a>
          <div class="clear"></div>
        </div>
      </div>`);
    });
    const service = new WorkGlossaryService(
      directory,
      fetch,
      [],
      '',
      `${server.baseUrl}/search`,
      null,
    );

    const result = await service.sync('原神');
    expect(result).toMatchObject({
      ok: true,
      report: { searchedQueries: 5, discoveredEntries: 3 },
    });
    expect(await service.findMatches('原神', '原神启动')).toEqual([
      expect.objectContaining({
        term: '原神，启动！',
        aliases: expect.arrayContaining(['原神启动']),
      }),
    ]);
    expect(await service.findMatches('原神', '哒哒哒哒哒，好想玩原神')).toEqual([
      expect.objectContaining({ term: '哒哒哒哒哒，好想玩原神' }),
    ]);
    expect(await service.findMatches('原神', '水龙水龙别哭了')).toEqual([
      expect.objectContaining({
        term: '水龙，水龙，别哭啦',
        aliases: expect.arrayContaining(['水龙水龙别哭了']),
      }),
    ]);
  });
});
