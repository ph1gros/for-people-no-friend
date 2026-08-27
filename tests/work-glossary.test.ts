import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  findRelevantGlossaryEntries,
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
    expect(findRelevantGlossaryEntries('325是什么？', [entry])).toEqual([entry]);
    expect(findRelevantGlossaryEntries('今天完成325大学习', [entry])).toEqual([entry]);
    expect(findRelevantGlossaryEntries('1325是什么？', [entry])).toEqual([]);
    expect(findRelevantGlossaryEntries('方舟社区那个低分梗是什么？', [entry])).toEqual([entry]);
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
    const service = new WorkGlossaryService(directory, fetch, catalog, '');
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
    const service = new WorkGlossaryService(directory, fetch, catalog, '');
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

  it('reports source failures and preserves the curated fallback without writing a cache', async () => {
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
    const service = new WorkGlossaryService(directory, fetch, catalog, '');
    const result = await service.sync('明日方舟');
    expect(result).toMatchObject({
      ok: false,
      report: {
        checkedSources: 1,
        verifiedSources: 0,
        failedSourceTitles: ['暂时失败的来源'],
        cachedEntries: 0,
      },
    });
    expect(result.message).toContain('原有本地词库保持不变');
    expect(await service.getStatus('明日方舟')).toMatchObject({
      cacheOrigin: 'curated',
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
    const service = new WorkGlossaryService(directory, fetch, catalog, `${server.baseUrl}/api.php`);
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
});
