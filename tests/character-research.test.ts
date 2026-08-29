import { describe, expect, it, vi } from 'vitest';

import {
  CharacterResearchService,
  DEFAULT_CHARACTER_LORE_GENERATION_TIMEOUT_MS,
} from '../src/main/character/character-research-service';

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
  it('allows character generation to run longer than the old 30 second limit', () => {
    expect(DEFAULT_CHARACTER_LORE_GENERATION_TIMEOUT_MS).toBe(180_000);
  });

  it('prefers an exact regional wiki page when full-text search only returns related assets', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === 'arknights.wiki.gg') {
        return new Response('unavailable', { status: 503 });
      }
      if (url.searchParams.get('list') === 'search') {
        return jsonResponse({
          query: {
            search:
              url.hostname === 'prts.wiki'
                ? [
                    {
                      pageid: 7,
                      title: '凯尔希的中坚信物',
                      snippet: '明日方舟中的道具。',
                    },
                  ]
                : [],
          },
        });
      }
      if (url.searchParams.get('titles') === '凯尔希') {
        return jsonResponse({
          query: {
            pages: [
              {
                pageid: url.hostname === 'moegirl.icu' ? 11 : 12,
                title: '凯尔希',
                fullurl: `https://${url.hostname}/${encodeURIComponent('凯尔希')}`,
                extract: '凯尔希是《明日方舟》中的角色。',
              },
            ],
          },
        });
      }
      return jsonResponse({ query: { search: [] } });
    });
    const service = new CharacterResearchService(fetcher as typeof fetch);

    await expect(service.search('search_regional_exact', '凯尔希', '明日方舟')).resolves.toEqual([
      expect.objectContaining({
        name: '凯尔希',
        sourceName: '萌娘百科',
        matchReason: '精确页面正文同时匹配“明日方舟”',
      }),
    ]);
  });

  it.each([
    ['贤者', '贤者（英语：Sage）是由拳头游戏开发并发行的游戏《无畏契约》的登场角色。', '无畏契约'],
    ['温迪', '温迪是米哈游研发的游戏《原神》及其衍生作品的登场角色。', '原神'],
    [
      '千早爱音',
      '千早爱音是企划《BanG Dream!》及其衍生作品的登场角色。乐队MyGO!!!!!的吉他手。',
      'BanG Dream! / MyGO!!!!!',
    ],
    [
      '晓山瑞希',
      '晓山瑞希是《世界计划 彩色舞台 feat. 初音未来》及其衍生作品的登场角色。',
      '世界计划 彩色舞台 feat. 初音未来',
    ],
    [
      '若叶睦',
      '若叶睦是企划《BanG Dream!》及其衍生作品的登场角色。乐队Ave Mujica的吉他手。',
      'BanG Dream! / Ave Mujica',
    ],
  ])(
    'infers and fills the source work for %s when the user leaves it blank',
    async (name, extract, expectedWork) => {
      const fetcher = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        if (url.searchParams.get('list') === 'search') {
          return jsonResponse({
            query: { search: [{ pageid: 1, title: name, snippet: `${name}的角色资料。` }] },
          });
        }
        return jsonResponse({
          query: {
            pages: [
              {
                pageid: 1,
                title: name,
                fullurl: `https://moegirl.icu/${encodeURIComponent(name)}`,
                extract,
              },
            ],
          },
        });
      });
      const service = new CharacterResearchService(fetcher as typeof fetch);

      await expect(service.search(`search_${name}`, name, '')).resolves.toEqual([
        expect.objectContaining({
          name,
          sourceWork: expectedWork,
          matchReason: `精确页面正文识别作品“${expectedWork}”`,
        }),
      ]);
    },
  );

  it('selects a work-specific character page instead of an exact-name disambiguation page', async () => {
    let receivedSourceText = '';
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === 'html.duckduckgo.com') {
        return xmlResponse(`<?xml version="1.0"?><rss><channel>
          <item><title>Luna voice lines</title><link>https://www.youtube.com/watch?v=unrelated</link><description>Azur Lane Luna voice lines</description></item>
        </channel></rss>`);
      }
      if (url.searchParams.get('list') === 'search') {
        return jsonResponse({
          query: {
            search: [
              {
                pageid: 1,
                title: '露娜',
                snippet: '露娜(神行少女)是另一角色。露娜(三角洲行动)是游戏《三角洲行动》的角色。',
              },
              {
                pageid: 2,
                title: '露娜(三角洲行动)',
                snippet: '露娜是游戏《三角洲行动》的侦察型特战干员。',
              },
            ],
          },
        });
      }
      return jsonResponse({
        query: {
          pages: [
            {
              pageid: 2,
              title: '露娜(三角洲行动)',
              fullurl: 'https://moegirl.icu/露娜(三角洲行动)',
              extract:
                '露娜（金卢娜）是《三角洲行动》的侦察型特战干员。她曾任情报官，擅长信息分析和箭术。',
            },
          ],
        },
      });
    });
    const service = new CharacterResearchService(fetcher as typeof fetch, {
      generateCharacterLore: vi.fn(async (input) => {
        receivedSourceText = input.sourceText;
        return { identity: '侦察型特战干员。' };
      }),
    });

    const candidates = await service.search('search_luna_delta', '露娜', '三角洲');
    expect(candidates).toEqual([
      expect.objectContaining({
        name: '露娜',
        sourceWork: '三角洲行动',
        sourceUrl:
          'https://moegirl.icu/%E9%9C%B2%E5%A8%9C(%E4%B8%89%E8%A7%92%E6%B4%B2%E8%A1%8C%E5%8A%A8)',
      }),
    ]);
    const draft = await service.buildDraft('draft_luna_delta', candidates[0]!.id);
    expect(draft.lore.sources).toHaveLength(1);
    expect(receivedSourceText).toContain('曾任情报官');
    expect(receivedSourceText).not.toContain('Azur Lane');
  });

  it('combines general wiki evidence and keeps late personality and relationship sections', async () => {
    let receivedSourceText = '';
    const longLead = '常规剧情经历。'.repeat(1_200);
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === 'html.duckduckgo.com') {
        return xmlResponse('<?xml version="1.0"?><rss><channel></channel></rss>');
      }
      if (url.searchParams.get('list') === 'search') {
        if (url.hostname === 'en.wikipedia.org') {
          return jsonResponse({ query: { search: [] } });
        }
        return jsonResponse({
          query: {
            search:
              url.hostname === 'moegirl.icu'
                ? [
                    {
                      pageid: 30,
                      title: '明日香',
                      snippet:
                        '星野明日香——《青涩宝贝》的角色。御岛明日香——《有你的小镇》的角色。惣流·明日香·兰格雷——《新世纪福音战士》的角色。',
                    },
                    {
                      pageid: 31,
                      title: '惣流·明日香·兰格雷',
                      snippet: '《新世纪福音战士》中的角色。',
                    },
                  ]
                : [
                    {
                      pageid: 32,
                      title: '惣流·明日香·兰格雷',
                      snippet: '《新世纪福音战士》中的角色。',
                    },
                  ],
          },
        });
      }
      if (url.hostname === 'en.wikipedia.org') {
        return jsonResponse({ query: { pages: [{ title: '明日香', missing: true }] } });
      }
      const isRegional = url.hostname === 'moegirl.icu';
      if (isRegional && url.searchParams.has('exintro')) {
        return jsonResponse({
          query: {
            pages: [
              {
                pageid: 30,
                title: '明日香',
                fullurl: 'https://moegirl.icu/明日香',
                extract:
                  '星野明日香——《青涩宝贝》的角色。御岛明日香——《有你的小镇》的角色。惣流·明日香·兰格雷——《新世纪福音战士》的角色。',
              },
            ],
          },
        });
      }
      if (!isRegional && url.searchParams.has('exintro')) {
        return jsonResponse({ query: { pages: [{ title: '明日香', missing: true }] } });
      }
      const extract = isRegional
        ? `惣流·明日香·兰格雷是《新世纪福音战士》中的角色。${longLead}\n性格\n骄傲好胜，外表强势但渴望认可。\n人物关系\n与碇真嗣既竞争又互相在意。`
        : `明日香是《新世纪福音战士》中的驾驶员。${longLead}\n说话方式\n表达直接，常以嘲讽掩盖不安。\n关系\n与绫波零长期处于对立状态。`;
      return jsonResponse({
        query: {
          pages: [
            {
              pageid: isRegional ? 31 : 32,
              title: '惣流·明日香·兰格雷',
              fullurl: `https://${url.hostname}/wiki/${encodeURIComponent('惣流·明日香·兰格雷')}`,
              extract,
            },
          ],
        },
      });
    });
    const service = new CharacterResearchService(fetcher as typeof fetch, {
      generateCharacterLore: vi.fn(async (input) => {
        receivedSourceText = input.sourceText;
        return {
          personality: '骄傲好胜，外表强势但渴望认可。',
          relationships: ['碇真嗣：既竞争又互相在意', '绫波零：长期对立'],
          speechStyle: '表达直接，常以嘲讽掩盖不安。',
        };
      }),
    });

    const candidate = (
      await service.search('search_asuka_cross_source', '明日香', '新世纪福音战士')
    )[0]!;
    const draft = await service.buildDraft('draft_asuka_cross_source', candidate.id);

    expect(candidate.name).toBe('惣流·明日香·兰格雷');
    expect(receivedSourceText).toContain('骄傲好胜');
    expect(receivedSourceText).toContain('碇真嗣');
    expect(receivedSourceText).toContain('表达直接');
    expect(receivedSourceText).toContain('绫波零');
    expect(draft.lore.sources).toEqual([
      expect.objectContaining({ siteName: '萌娘百科' }),
      expect.objectContaining({ siteName: '中文维基百科' }),
    ]);
    expect(draft.lore.personality).toContain('渴望认可');
    expect(draft.lore.relationships).toHaveLength(2);
    expect(draft.lore.speechStyle).toContain('嘲讽掩盖不安');
  });

  it('accepts a surname-prefixed full character name for an ambiguous short name', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.searchParams.get('list') === 'search') {
        expect(url.searchParams.get('srlimit')).toBe('8');
        return jsonResponse({
          query: {
            search:
              url.hostname === 'moegirl.icu'
                ? [
                    ...Array.from({ length: 4 }, (_, index) => ({
                      pageid: 35 + index,
                      title: `蔚蓝档案/资料${index + 1}`,
                      snippet: '作品资料页中提到了爱丽丝，但不是角色个人页面。',
                    })),
                    {
                      pageid: 40,
                      title: '爱丽丝',
                      snippet:
                        '爱丽丝可以指《东方Project旧作》的角色，也可以指《蔚蓝档案》的天童爱丽丝或其他同名角色。',
                    },
                    {
                      pageid: 41,
                      title: '天童爱丽丝',
                      snippet: '天童爱丽丝是游戏《蔚蓝档案》中游戏开发部的角色。',
                    },
                  ]
                : [],
          },
        });
      }
      if (url.searchParams.has('exintro')) {
        return jsonResponse({
          query: {
            pages:
              url.hostname === 'moegirl.icu'
                ? [
                    {
                      pageid: 40,
                      title: '爱丽丝',
                      fullurl: 'https://moegirl.icu/爱丽丝',
                      extract:
                        '爱丽丝可以指《东方Project旧作》的角色，也可以指《蔚蓝档案》的天童爱丽丝或其他同名角色。',
                    },
                  ]
                : [{ title: '爱丽丝', missing: true }],
          },
        });
      }
      return jsonResponse({ query: { search: [] } });
    });
    const service = new CharacterResearchService(fetcher as typeof fetch);

    await expect(
      service.search('search_alice_blue_archive', '爱丽丝', '蔚蓝档案'),
    ).resolves.toEqual([
      expect.objectContaining({
        name: '天童爱丽丝',
        sourceWork: '蔚蓝档案',
        sourceName: '萌娘百科',
      }),
    ]);
  });

  it('rejects work-wide list pages and accepts a work-matched individual Wuthering Waves page', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      expect(url.hostname).toBe('wutheringwaves.fandom.com');
      expect(url.pathname).toBe('/zh/api.php');
      return jsonResponse({
        query: {
          search: [
            { pageid: 10, title: '鸣潮角色列表', snippet: '正文中提到了守岸人。' },
            { pageid: 11, title: '守岸人', snippet: '《鸣潮》中的可操作角色。' },
          ],
        },
      });
    }) as unknown as typeof fetch;

    const service = new CharacterResearchService(fetcher);
    const candidates = await service.search('search_shorekeeper', '守岸人', '鸣潮');

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      name: '守岸人',
      sourceWork: '鸣潮 / Wuthering Waves',
      sourceName: '鸣潮 Wiki',
    });
  });

  it('does not expose a loosely related general-wiki result as a character candidate', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        query: {
          search: [
            {
              pageid: 12,
              title: '鸣潮角色列表',
              snippet: '2026年，某段正文碰巧提到了守岸人。',
            },
          ],
        },
      }),
    ) as unknown as typeof fetch;

    const service = new CharacterResearchService(fetcher);
    await expect(service.search('search_bad_list', '守岸人', '未知作品')).resolves.toEqual([]);
  });

  it('rejects resource, subpage and non-character entries from the candidate list', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === 'arknights.wiki.gg') {
        throw new Error('preferred source unavailable');
      }
      if (url.hostname === 'prts.wiki') {
        return jsonResponse({
          query: {
            search: [
              {
                pageid: 21,
                title: '变格凯尔希(敌人)/spine',
                snippet: 'PRTS Wiki 明日方舟资源页。',
              },
              {
                pageid: 22,
                title: '凯尔希的中坚怪物',
                snippet: '用于搜寻凯尔希的道路。',
              },
              {
                pageid: 23,
                title: '凯尔希/语音记录',
                snippet: '凯尔希的语音台词。',
              },
            ],
          },
        });
      }
      return new Response('', { status: 503 });
    }) as unknown as typeof fetch;

    const service = new CharacterResearchService(fetcher);
    await expect(service.search('search_reject_assets', '凯尔希', '明日方舟')).resolves.toEqual([]);
  });

  it('falls back to a public web query composed from the character name and source work', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname.endsWith('wikipedia.org')) {
        return jsonResponse({
          query: {
            search: [{ pageid: 9, title: '角色甲', snippet: '这是《另一部作品》的同名人物。' }],
          },
        });
      }
      expect(url.hostname).toBe('html.duckduckgo.com');
      expect(url.searchParams.get('q')).toBe('角色甲 测试游戏 角色资料');
      const target = encodeURIComponent('https://example.fandom.com/zh/wiki/角色甲');
      const baiduTarget = encodeURIComponent('https://baike.baidu.com/item/角色甲');
      return new Response(
        `<html><div class="result results_links result--url-above-snippet">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=${baiduTarget}">角色甲 - 百度百科</a>
          <a class="result__snippet">角色甲是《测试游戏》中的登场角色。</a>
          <div class="clear"></div></div>
          <div class="result results_links result--url-above-snippet">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=${target}">角色甲 | 测试游戏 Wiki</a>
          <a class="result__snippet">角色甲是《测试游戏》中的登场角色。</a>
          <div class="clear"></div></div></html>`,
        { headers: { 'content-type': 'text/html; charset=UTF-8' } },
      );
    }) as unknown as typeof fetch;

    const service = new CharacterResearchService(fetcher);
    const candidates = await service.search('search_public_web', '角色甲', '测试游戏');

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      name: '角色甲',
      sourceWork: '测试游戏',
      sourceName: 'Fandom 社区 Wiki',
    });
    expect(candidates[1]?.sourceName).toBe('百度百科');
  });

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
      userDisplayName: '博士',
      bio: '陪伴在桌面上的 AI 角色。',
      personaPrompt: '保持自然、真诚、简洁的交流风格。不要假装拥有未提供的记忆或能力。',
    });
    expect(draft.warnings[0]).toContain('详细字段保持为空');
  });

  it('uses the work-level player title without misreading a speech-style sentence', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.searchParams.get('list') === 'search') {
        return jsonResponse(
          url.hostname === 'zh.wikipedia.org'
            ? { query: { search: [{ pageid: 7, title: '刻晴', snippet: '《原神》中的角色。' }] } }
            : { query: { search: [] } },
        );
      }
      return jsonResponse({
        query: {
          pages: [
            {
              pageid: 7,
              title: '刻晴',
              fullurl: 'https://zh.wikipedia.org/wiki/刻晴',
              extract: '刻晴是《原神》中的璃月七星玉衡星。',
            },
          ],
        },
      });
    });
    const service = new CharacterResearchService(fetcher as typeof fetch, {
      generateCharacterLore: vi.fn(async () => ({
        identity: '璃月七星中的玉衡星。',
        speechStyle: '对用户说话时较为直接，表达清楚而果断。',
      })),
    });
    const candidate = (await service.search('search_keqing', '刻晴', '原神'))[0]!;
    const draft = await service.buildDraft('draft_keqing', candidate.id);

    expect(draft.profileFields.userDisplayName).toBe('旅行者');
    expect(draft.profileFields.userDisplayName).not.toBe('时较为直接');
  });

  it('rejects an incomplete generated user-address fragment as a speech style', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.searchParams.get('list') === 'search') {
        return jsonResponse({
          query: {
            search: [{ title: '露娜(三角洲行动)', snippet: '三角洲行动中的侦察干员。' }],
          },
        });
      }
      return jsonResponse({
        query: {
          pages: [
            {
              pageid: 1,
              title: '露娜(三角洲行动)',
              fullurl: 'https://moegirl.icu/露娜(三角洲行动)',
              extract: '露娜是《三角洲行动》中的侦察干员。',
            },
          ],
        },
      });
    });
    const service = new CharacterResearchService(fetcher as typeof fetch, {
      generateCharacterLore: vi.fn(async () => ({
        identity: '侦察型特战干员。',
        speechStyle: '称呼用户为',
      })),
    });
    const candidate = (await service.search('search_incomplete_speech', '露娜', '三角洲'))[0]!;
    const draft = await service.buildDraft('draft_incomplete_speech', candidate.id);

    expect(draft.lore.speechStyle).toBe('通常直接称用户为“你”。');
    expect(draft.profileFields.userDisplayName).toBe('你');
    expect(draft.profileFields.personaPrompt).not.toMatch(/称呼用户为$/u);
    expect(draft.warnings).toContain(
      '模型返回的说话方式不完整；已恢复能够确认的称呼规则，其他表达特点可以重新整理。',
    );
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
      if (url.hostname === 'html.duckduckgo.com') {
        webSearches += 1;
        const address = url.searchParams.get('q')?.match(/称呼|玩家|主角/u);
        const dialogue = url.searchParams.get('q')?.match(/台词|セリフ/u);
        if (address) {
          return xmlResponse(`<?xml version="1.0"?><rss><channel>
            <item><title>伊雷娜如何称呼玩家</title><link>https://anibase.net/ja/character/elaina-address</link><description>《魔女之旅》伊雷娜与玩家对话时使用旅行者这一称呼</description></item>
          </channel></rss>`);
        }
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
        return new Response(
          url.pathname.endsWith('elaina-address')
            ? '<html><h1>伊雷娜玩家称呼</h1><p>与玩家对话时称为旅行者。</p></html>'
            : '<html><h1>伊雷娜</h1><p>魔女之旅的灰之魔女与旅行者。</p></html>',
          { headers: { 'content-type': 'text/html' } },
        );
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

    expect(webSearches).toBe(4);
    expect(receivedSourceText).toContain('没错，就是我');
    expect(receivedSourceText).toContain('灰之魔女');
    expect(receivedSourceText).toContain('称为旅行者');
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
