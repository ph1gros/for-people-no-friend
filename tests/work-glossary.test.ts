import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  findRelevantGlossaryEntries,
  formatWorkGlossaryContext,
  resolveWorkGlossaryId,
  type WorkGlossaryEntry,
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
    expect(resolveWorkGlossaryId('《魔女之旅》')).toBe('wandering-witch');
    expect(resolveWorkGlossaryId('Wandering Witch')).toBe('wandering-witch');
    expect(findRelevantGlossaryEntries('325是什么？', [entry])).toEqual([entry]);
    expect(findRelevantGlossaryEntries('今天完成325大学习', [entry])).toEqual([entry]);
    expect(findRelevantGlossaryEntries('1325是什么？', [entry])).toEqual([]);
  });

  it('formats matched entries as community context rather than canon', () => {
    const context = formatWorkGlossaryContext([entry]);
    expect(context).toContain('作品专名或玩家社区语境');
    expect(context).toContain('如果你指社区里说的');
    expect(context).toContain('325');
  });

  it('ships an offline Witch Journey glossary separately from character lore', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-witch-glossary-test-'));
    const service = new WorkGlossaryService(directory, fetch, undefined, '');
    const status = await service.getStatus('魔女之旅');
    expect(status).toMatchObject({ supported: true, workName: '魔女之旅', entryCount: 4 });
    expect(await service.findMatches('魔女之旅', '妮可冒险谭是什么？')).toEqual([
      expect.objectContaining({
        term: '妮可冒险谭',
        originContext: expect.stringContaining('作品内书名'),
      }),
    ]);
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
    expect(result.status.lastSynced).toBeTypeOf('number');
    expect(result.status.sources).toHaveLength(2);
    expect((await service.findMatches('明日方舟', '325是什么'))[0]).toMatchObject({
      term: '325',
      confidence: 0.93,
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
