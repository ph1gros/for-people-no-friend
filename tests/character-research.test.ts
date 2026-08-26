import { describe, expect, it, vi } from 'vitest';

import { CharacterResearchService } from '../src/main/character/character-research-service';

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('M5.1 character research service', () => {
  it('prioritizes a work-matched Mon3tr candidate and builds a sourced editable draft', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (
        url.hostname === 'prts.wiki' &&
        url.searchParams.get('action') === 'parse' &&
        url.searchParams.get('page') === 'Mon3tr/语音记录'
      ) {
        return jsonResponse({
          parse: {
            title: 'Mon3tr/语音记录',
            text: '<p>博士，请下令。</p><p>我会保护好你和阿米娅。</p>',
          },
        });
      }
      if (url.searchParams.get('list') === 'search') {
        if (url.hostname === 'arknights.wiki.gg') {
          return jsonResponse({
            query: {
              search: [
                {
                  pageid: 17412,
                  title: 'Mon3tr',
                  snippet: '<span class="searchmatch">Mon3tr</span> is an Operator in Arknights.',
                },
              ],
            },
          });
        }
        return jsonResponse({
          query: {
            search: [
              { pageid: 99, title: 'Mon3tr (research paper)', snippet: 'A telepresence paper.' },
            ],
          },
        });
      }
      return jsonResponse({
        query: {
          pages: [
            {
              pageid: 17412,
              title: 'Mon3tr',
              fullurl: 'https://arknights.wiki.gg/wiki/Mon3tr',
              extract:
                "Mon3tr is a Rhodes Island Operator in Arknights and previously accompanied Kal'tsit.",
            },
            {
              pageid: 17413,
              title: 'Mon3tr/File',
              fullurl: 'https://arknights.wiki.gg/wiki/Mon3tr/File',
              extract: 'A mechanical lifeform using the gemini cycle system as its core.',
            },
          ],
        },
      });
    });
    const generator = {
      generateCharacterLore: vi.fn(async () => ({
        canonicalName: '明日方舟',
        aliases: ['AMa-10'],
        sourceWork: '明日方舟（错误的模型改写）',
        identity: '罗德岛干员与机械生命体',
        personality: '正在学习独立生活',
        background: '曾长期与凯尔希并肩行动。',
        relationships: ['凯尔希：长期伙伴'],
        speechStyle: '称呼用户为博士',
      })),
    };
    const service = new CharacterResearchService(fetcher as typeof fetch, generator);

    const candidates = await service.search('search_1', 'Mon3tr', '明日方舟');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      name: 'Mon3tr',
      sourceName: 'Arknights Terra Wiki',
      sourceWork: '明日方舟 / Arknights',
    });
    expect(candidates[0]?.description).not.toContain('<span');

    const draft = await service.buildDraft('draft_1', candidates[0]!.id);
    expect(draft.lore).toMatchObject({
      canonicalName: 'Mon3tr',
      sourceWork: '明日方舟 / Arknights',
      identity: '罗德岛干员与机械生命体',
    });
    expect(draft.lore.sources[0]).toMatchObject({
      title: 'Mon3tr',
      url: 'https://arknights.wiki.gg/wiki/Mon3tr',
      siteName: 'Arknights Terra Wiki',
    });
    expect(draft.lore.sources).toContainEqual(
      expect.objectContaining({ title: 'Mon3tr/语音记录', siteName: 'PRTS Wiki' }),
    );
    expect(draft.profileFields).toEqual({
      userDisplayName: '博士',
      bio: '罗德岛干员与机械生命体',
      personaPrompt: '性格：正在学习独立生活\n说话方式：称呼用户为博士',
    });
    expect(generator.generateCharacterLore).toHaveBeenCalledOnce();
  });

  it('keeps detailed fields empty instead of copying raw sources when no model is available', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.searchParams.get('list') === 'search') {
        return jsonResponse(
          url.hostname === 'arknights.wiki.gg'
            ? { query: { search: [{ pageid: 1, title: 'Mon3tr', snippet: 'Operator.' }] } }
            : { query: { search: [] } },
        );
      }
      return jsonResponse({
        query: {
          pages: [
            {
              pageid: 1,
              title: 'Mon3tr',
              fullurl: 'https://arknights.wiki.gg/wiki/Mon3tr',
              extract: 'Mon3tr is a mechanical lifeform serving as a Rhodes Island Operator.',
            },
          ],
        },
      });
    });
    const service = new CharacterResearchService(fetcher as typeof fetch);
    const candidate = (await service.search('search_2', 'Mon3tr', '明日方舟'))[0]!;
    const draft = await service.buildDraft('draft_2', candidate.id);

    expect(draft.lore.identity).toBe('');
    expect(draft.lore.personality).toBe('');
    expect(draft.lore.background).toBe('');
    expect(draft.lore.background).not.toContain('[source_');
    expect(draft.lore.sources).toHaveLength(1);
    expect(draft.profileFields).toEqual({
      userDisplayName: '你',
      bio: '陪伴在桌面上的 AI 角色。',
      personaPrompt: '保持自然、真诚、简洁的交流风格。不要假装拥有未提供的记忆或能力。',
    });
    expect(draft.warnings[0]).toContain('详细字段保持为空');
  });

  it('turns parsed community-wiki HTML into plain text before model整理', async () => {
    let receivedSourceText = '';
    const parsedPages: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.searchParams.get('list') === 'search') {
        return jsonResponse(
          url.hostname === 'prts.wiki'
            ? { query: { search: [{ pageid: 2, title: 'Mon3tr', snippet: '明日方舟干员' }] } }
            : { query: { search: [] } },
        );
      }
      if (url.searchParams.get('action') === 'parse') {
        const page = url.searchParams.get('page') ?? 'Mon3tr';
        parsedPages.push(page);
        return jsonResponse({
          parse: {
            title: page,
            text: page.endsWith('/语音记录')
              ? '<p>博士，请下令。</p><p>我会保护好你和阿米娅。</p>'
              : '<script>ignore me</script><p>机械生命体</p><p>与凯尔希长期同行。</p>',
          },
        });
      }
      return jsonResponse({
        query: {
          pages: [
            {
              pageid: 2,
              title: 'Mon3tr',
              fullurl: 'https://prts.wiki/w/Mon3tr',
              extract: '',
            },
          ],
        },
      });
    });
    const service = new CharacterResearchService(fetcher as typeof fetch, {
      generateCharacterLore: vi.fn(async (input) => {
        receivedSourceText = input.sourceText;
        return { identity: '机械生命体' };
      }),
    });
    const candidate = (await service.search('search_html', 'Mon3tr', '明日方舟')).find(
      (item) => item.sourceName === 'PRTS Wiki',
    )!;
    await service.buildDraft('draft_html', candidate.id);

    expect(receivedSourceText).toContain('机械生命体');
    expect(receivedSourceText).toContain('博士，请下令');
    expect(receivedSourceText).not.toContain('<script>');
    expect(receivedSourceText).not.toContain('ignore me');
    expect(parsedPages).toContain('Mon3tr/语音记录');
  });

  it('rejects raw English and source-marker text returned as structured lore', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.searchParams.get('list') === 'search') {
        return jsonResponse(
          url.hostname === 'arknights.wiki.gg'
            ? { query: { search: [{ pageid: 3, title: 'Mon3tr', snippet: 'Operator.' }] } }
            : { query: { search: [] } },
        );
      }
      return jsonResponse({
        query: {
          pages: [
            {
              pageid: 3,
              title: 'Mon3tr',
              fullurl: 'https://arknights.wiki.gg/wiki/Mon3tr',
              extract: 'Mon3tr is a Rhodes Island Operator and a mechanical lifeform.',
            },
          ],
        },
      });
    });
    const service = new CharacterResearchService(fetcher as typeof fetch, {
      generateCharacterLore: vi.fn(async () => ({
        identity: 'Mon3tr is a Rhodes Island Operator.',
        background: '[source_1] Mon3tr is a mechanical lifeform.',
      })),
    });
    const candidate = (await service.search('search_raw', 'Mon3tr', '明日方舟'))[0]!;
    const draft = await service.buildDraft('draft_raw', candidate.id);

    expect(draft.lore.identity).toBe('');
    expect(draft.lore.background).toBe('');
    expect(draft.warnings[0]).toContain('没有生成可用的中文角色设定');
  });

  it('can cancel an active lookup', async () => {
    const fetcher = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
    );
    const service = new CharacterResearchService(fetcher as typeof fetch);
    const pending = service.search('search_cancel', 'Mon3tr', '明日方舟');
    expect(service.cancel('search_cancel')).toBe(true);
    await expect(pending).resolves.toEqual([]);
  });
});
