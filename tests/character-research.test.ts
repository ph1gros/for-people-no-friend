import { describe, expect, it, vi } from 'vitest';

import { CharacterResearchService } from '../src/main/character/character-research-service';

const jsonResponse = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const xmlResponse = (value: string): Response =>
  new Response(value, {
    status: 200,
    headers: { 'content-type': 'text/xml; charset=utf-8' },
  });

describe('M5.1 character research service', () => {
  it('prioritizes a work-matched Kaltsit candidate and builds a sourced editable draft', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (
        url.hostname === 'prts.wiki' &&
        url.searchParams.get('action') === 'parse' &&
        url.searchParams.get('page') === '凯尔希/语音记录'
      ) {
        return jsonResponse({
          parse: {
            title: '凯尔希/语音记录',
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
                  title: '凯尔希',
                  snippet: '<span class="searchmatch">凯尔希</span> is an Operator in Arknights.',
                },
              ],
            },
          });
        }
        return jsonResponse({
          query: {
            search: [{ pageid: 99, title: '凯尔希（无关条目）', snippet: 'An unrelated result.' }],
          },
        });
      }
      return jsonResponse({
        query: {
          pages: [
            {
              pageid: 17412,
              title: '凯尔希',
              fullurl: 'https://arknights.wiki.gg/wiki/Kal%27tsit',
              extract: "Kal'tsit is a Rhodes Island medical leader and Operator in Arknights.",
            },
            {
              pageid: 17413,
              title: "Kal'tsit/File",
              fullurl: 'https://arknights.wiki.gg/wiki/Kal%27tsit/File',
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

    const candidates = await service.search('search_1', '凯尔希', '明日方舟');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      name: '凯尔希',
      sourceName: 'Arknights Terra Wiki',
      sourceWork: '明日方舟 / Arknights',
    });
    expect(candidates[0]?.description).not.toContain('<span');

    const draft = await service.buildDraft('draft_1', candidates[0]!.id);
    expect(draft.lore).toMatchObject({
      canonicalName: '凯尔希',
      sourceWork: '明日方舟 / Arknights',
      identity: '罗德岛干员与机械生命体',
    });
    expect(draft.lore.sources[0]).toMatchObject({
      title: '凯尔希',
      url: 'https://arknights.wiki.gg/wiki/Kal%27tsit',
      siteName: 'Arknights Terra Wiki',
    });
    expect(draft.lore.sources).toContainEqual(
      expect.objectContaining({ title: '凯尔希/语音记录', siteName: 'PRTS Wiki' }),
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
            ? { query: { search: [{ pageid: 1, title: '凯尔希', snippet: 'Operator.' }] } }
            : { query: { search: [] } },
        );
      }
      return jsonResponse({
        query: {
          pages: [
            {
              pageid: 1,
              title: '凯尔希',
              fullurl: 'https://arknights.wiki.gg/wiki/Kal%27tsit',
              extract: 'Kaltsit is a medical leader serving as a Rhodes Island Operator.',
            },
          ],
        },
      });
    });
    const service = new CharacterResearchService(fetcher as typeof fetch);
    const candidate = (await service.search('search_2', '凯尔希', '明日方舟'))[0]!;
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
            ? { query: { search: [{ pageid: 2, title: '凯尔希', snippet: '明日方舟干员' }] } }
            : { query: { search: [] } },
        );
      }
      if (url.searchParams.get('action') === 'parse') {
        const page = url.searchParams.get('page') ?? '凯尔希';
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
              title: '凯尔希',
              fullurl: 'https://prts.wiki/w/凯尔希',
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
    const candidate = (await service.search('search_html', '凯尔希', '明日方舟')).find(
      (item) => item.sourceName === 'PRTS Wiki',
    )!;
    await service.buildDraft('draft_html', candidate.id);

    expect(receivedSourceText).toContain('机械生命体');
    expect(receivedSourceText).toContain('博士，请下令');
    expect(receivedSourceText).not.toContain('<script>');
    expect(receivedSourceText).not.toContain('ignore me');
    expect(parsedPages).toContain('凯尔希/语音记录');
  });

  it('fans out to allowlisted profile and dialogue pages after candidate confirmation', async () => {
    let receivedSourceText = '';
    let webSearches = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === 'www.bing.com') {
        webSearches += 1;
        const dialogue = url.searchParams.get('q')?.match(/台词|セリフ/u);
        return xmlResponse(`<?xml version="1.0"?><rss><channel>
          <item><title>伊雷娜台词整理</title><link>https://animemanga33.com/archives/28357</link><description>《魔女之旅》伊雷娜分话台词与名言</description></item>
          <item><title>伊雷娜秘密资料</title><link>http://127.0.0.1/private</link><description>不允许的地址</description></item>
          ${dialogue ? '' : '<item><title>伊雷娜角色资料</title><link>https://anibase.net/ja/character/elaina</link><description>《魔女之旅》角色身份、背景和关系</description></item>'}
        </channel></rss>`);
      }
      if (url.hostname === 'animemanga33.com') {
        return new Response(
          '<html><h1>伊雷娜台词</h1><p>没错，就是我。</p><p>这听起来很可疑呢。</p></html>',
          { headers: { 'content-type': 'text/html' } },
        );
      }
      if (url.hostname === 'anibase.net') {
        return new Response('<html><h1>伊雷娜</h1><p>魔女之旅的灰之魔女与旅行者。</p></html>', {
          headers: { 'content-type': 'text/html' },
        });
      }
      if (url.searchParams.get('list') === 'search') {
        return jsonResponse(
          url.hostname === 'zh.wikipedia.org'
            ? {
                query: {
                  search: [{ pageid: 1, title: '伊雷娜', snippet: '《魔女之旅》的角色。' }],
                },
              }
            : { query: { search: [] } },
        );
      }
      return jsonResponse({
        query: {
          pages: [
            {
              pageid: 1,
              title: '伊雷娜',
              fullurl: 'https://zh.wikipedia.org/wiki/伊雷娜',
              extract: '伊雷娜是《魔女之旅》的旅行魔女。',
            },
          ],
        },
      });
    });
    const service = new CharacterResearchService(fetcher as typeof fetch, {
      generateCharacterLore: vi.fn(async (input) => {
        receivedSourceText = input.sourceText;
        return {
          identity: '四处旅行的灰之魔女。',
          personality: '冷静、自信而有好奇心。',
          background: '受到旅行故事影响而成为魔女。',
          relationships: ['芙兰：老师'],
          speechStyle: '礼貌从容，偶尔用自问自答表现自信。',
          sampleLines: Array.from({ length: 22 }, (_, index) => `短台词${index + 1}`),
          roleplayExamples: [
            {
              scene: '遇到可疑说法',
              emotion: '怀疑',
              trigger: '用户给出前后矛盾的信息',
              attitude: '先观察再判断',
              line: '这听起来很可疑呢。',
              sourceId: 'source_2',
            },
            {
              scene: '无证据场景',
              emotion: '平静',
              trigger: '没有来源',
              attitude: '随意',
              line: '这条不该保留。',
              sourceId: 'source_99',
            },
          ],
        };
      }),
    });

    const candidate = (await service.search('search_irena', '伊雷娜', '魔女之旅'))[0]!;
    const draft = await service.buildDraft('draft_irena', candidate.id);

    expect(webSearches).toBe(3);
    expect(receivedSourceText).toContain('没错，就是我');
    expect(receivedSourceText).toContain('灰之魔女');
    expect(receivedSourceText).not.toContain('127.0.0.1');
    expect(draft.lore.sources).toContainEqual(
      expect.objectContaining({ url: 'https://animemanga33.com/archives/28357' }),
    );
    expect(draft.lore.sampleLines).toHaveLength(20);
    expect(draft.lore.roleplayExamples).toEqual([
      expect.objectContaining({ scene: '遇到可疑说法', sourceId: 'source_2' }),
    ]);
  });

  it('rejects raw English and source-marker text returned as structured lore', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.searchParams.get('list') === 'search') {
        return jsonResponse(
          url.hostname === 'arknights.wiki.gg'
            ? { query: { search: [{ pageid: 3, title: '凯尔希', snippet: 'Operator.' }] } }
            : { query: { search: [] } },
        );
      }
      return jsonResponse({
        query: {
          pages: [
            {
              pageid: 3,
              title: '凯尔希',
              fullurl: 'https://arknights.wiki.gg/wiki/Kal%27tsit',
              extract: 'Kaltsit is a Rhodes Island medical leader and Operator.',
            },
          ],
        },
      });
    });
    const service = new CharacterResearchService(fetcher as typeof fetch, {
      generateCharacterLore: vi.fn(async () => ({
        identity: 'Kaltsit is a Rhodes Island medical leader.',
        background: '[source_1] Kaltsit has served Rhodes Island for a long time.',
      })),
    });
    const candidate = (await service.search('search_raw', '凯尔希', '明日方舟'))[0]!;
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
    const pending = service.search('search_cancel', '凯尔希', '明日方舟');
    expect(service.cancel('search_cancel')).toBe(true);
    await expect(pending).resolves.toEqual([]);
  });
});
