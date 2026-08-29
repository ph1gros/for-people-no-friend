import { randomUUID } from 'node:crypto';

import {
  sanitizeCharacterSpeechStyle,
  type CharacterLore,
  type CharacterRoleplayExample,
} from '../../core/character/character-lore';
import type {
  CharacterResearchCandidate,
  CharacterResearchDraft,
} from '../../core/character/character-research';
import {
  DEFAULT_CHARACTER_PROFILE,
  KALTSIT_CHARACTER_PROFILE,
} from '../../core/conversation/character-profile';

export interface CharacterLoreGenerationInput {
  canonicalName: string;
  sourceWork: string;
  sourceText: string;
}

export type CharacterLoreGenerationResult = Partial<Omit<CharacterLore, 'sources'>> & {
  userDisplayName?: string;
};

export interface CharacterLoreGenerator {
  generateCharacterLore(
    input: CharacterLoreGenerationInput,
    signal?: AbortSignal,
  ): Promise<CharacterLoreGenerationResult>;
}

interface CharacterSourceDefinition {
  id: string;
  label: string;
  priority: number;
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
  requestedName: string;
  source?: CharacterSourceDefinition;
  pageId?: number;
  title: string;
  webResult?: WebSearchResult;
  expiresAt: number;
}

interface ResearchPage {
  title: string;
  url: string;
  extract: string;
  siteName: string;
}

interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  kind: 'profile' | 'dialogue' | 'address';
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
    id: 'moegirl-wiki',
    label: '萌娘百科',
    priority: 700,
    origin: 'https://moegirl.icu',
    apiPath: '/api.php',
    articlePath: '/',
    workHints: [],
    canonicalWork: '',
    detailSuffixes: [],
  },
  {
    id: 'arknights-terra-wiki',
    label: 'Arknights Terra Wiki',
    priority: 300,
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
    priority: 450,
    origin: 'https://prts.wiki',
    apiPath: '/api.php',
    articlePath: '/w/',
    workHints: ['明日方舟', 'arknights'],
    canonicalWork: '明日方舟 / Arknights',
    detailSuffixes: ['/语音记录'],
    parseMainPage: true,
  },
  {
    id: 'wuthering-waves-fandom',
    label: '鸣潮 Wiki',
    priority: 300,
    origin: 'https://wutheringwaves.fandom.com',
    apiPath: '/zh/api.php',
    articlePath: '/zh/wiki/',
    workHints: ['鸣潮', '鳴潮', 'wuthering waves'],
    canonicalWork: '鸣潮 / Wuthering Waves',
    detailSuffixes: ['/鉴定报告与故事', '/语音'],
  },
  {
    id: 'zh-wikipedia',
    label: '中文维基百科',
    priority: 150,
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
    priority: 100,
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
const MAX_SOURCE_TEXT_CHARACTERS = 12_000;
const CANDIDATE_TTL_MS = 10 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 5_000;
export const DEFAULT_CHARACTER_LORE_GENERATION_TIMEOUT_MS = 180_000;
const WEB_SEARCH_ORIGIN = 'https://html.duckduckgo.com';
const WEB_SEARCH_PATH = '/html/';
const SUPPLEMENTAL_HOSTS = [
  'wikipedia.org',
  'wiki.gg',
  'fandom.com',
  'prts.wiki',
  'moegirl.org.cn',
  'atwiki.jp',
  'animemanga33.com',
  'anibase.net',
  'sbcr.jp',
  'kadokawa.co.jp',
  'kadokawa-animation.jp',
  'square-enix.com',
  'bilibili.com',
  'biligame.com',
  'baike.baidu.com',
  'huijiwiki.com',
  'gamekee.com',
  'kurogame.com',
  'youtube.com',
  'youtu.be',
  'nicovideo.jp',
  'evageeks.org',
] as const;
const DIALOGUE_MARKER =
  /(台词|臺詞|语音|語音|对白|對白|名言|セリフ|ボイス|quotes?|voice\s*lines?)/iu;
const ADDRESS_MARKER = /(称呼|稱呼|叫法|玩家|主角|旅行者|博士|呼び方|主人公|プレイヤー|よびかた)/iu;
const INDEX_PAGE_MARKER =
  /(?:角色|人物|登场人物|登場人物|共鸣者|共鳴者|characters?)\s*(?:列表|一览|一覽|图鉴|圖鑑|名单|名單|list|index)|(?:列表|一览|一覽|图鉴|圖鑑|名单|名單)\s*(?:角色|人物|characters?)/iu;
const NON_CHARACTER_PAGE_MARKER =
  /(?:^|[\s（(\-—|｜:：])(spine|sprite|skin|skins|file|dialogue|voice|voices|gallery|enemy|enemies|npc|技能|天赋|天賦|语音|語音|台词|臺詞|对白|對白|立绘|立繪|模型|皮肤|皮膚|敌人|敵人|怪物|道具|家具|模组|模組|召唤物|召喚物)(?:$|[\s）)\-—|｜:：])/iu;

const normalize = (value: string): string => value.normalize('NFKC').trim().toLowerCase();
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const parentheticalWorkForTitle = (
  title: string,
  name: string,
  requestedWork: string,
): string | undefined => {
  const match = new RegExp(
    `^${escapeRegExp(name.trim())}\\s*[（(]([^）)]{1,120})[）)]$`,
    'iu',
  ).exec(title.trim());
  const work = match?.[1]?.trim();
  if (!work) return undefined;
  const normalizedWork = normalize(work);
  const normalizedRequested = normalize(requestedWork);
  return !normalizedRequested ||
    normalizedWork.includes(normalizedRequested) ||
    normalizedRequested.includes(normalizedWork)
    ? work
    : undefined;
};

const delimitedWorkForTitle = (title: string, name: string): string | undefined => {
  const match = new RegExp(
    `^${escapeRegExp(name.trim())}\\s*(?:[-–—|｜:：])\\s*([^-–—|｜:：]{1,100})$`,
    'iu',
  ).exec(title.trim());
  return match?.[1]?.trim() || undefined;
};

const quotedWorkFromText = (value: string): string | undefined => {
  const contextual =
    /《([^《》\n]{1,120})》(?:及其衍生作品)?(?:中|里的|的)?(?:登场|登場|可操作)?角色/iu.exec(
      value,
    )?.[1];
  return contextual?.trim() || /《([^《》\n]{1,120})》/u.exec(value)?.[1]?.trim() || undefined;
};

const specializeWorkFromDescription = (work: string, description: string): string => {
  if (!/bang\s*dream/iu.test(work)) return work;
  const group =
    /(?:乐队|樂隊|乐团|樂團)\s*([A-Za-z][A-Za-z0-9 .!?☆★]{1,40}?)(?=的|，|。|、|；|$)/u.exec(
      description,
    )?.[1];
  const normalizedGroup = group?.replace(/\s+/gu, ' ').trim();
  return normalizedGroup && !normalize(work).includes(normalize(normalizedGroup))
    ? `${work} / ${normalizedGroup}`
    : work;
};

const inferSourceWork = (input: {
  title: string;
  name: string;
  requestedWork: string;
  description: string;
  canonicalWork?: string;
}): string => {
  const work =
    input.canonicalWork?.trim() ||
    parentheticalWorkForTitle(input.title, input.name, input.requestedWork) ||
    input.requestedWork.trim() ||
    quotedWorkFromText(input.description) ||
    delimitedWorkForTitle(input.title, input.name) ||
    '';
  return work ? specializeWorkFromDescription(work, input.description) : '';
};

const isLikelyDisambiguationPage = (title: string, name: string, description: string): boolean => {
  if (normalize(title) !== normalize(name)) return false;
  if (/(?:消歧义|消歧義|可以指|可能指|同名角色|按姓氏.*排序)/iu.test(description)) return true;
  const variants = description.match(
    new RegExp(`${escapeRegExp(name.trim())}\\s*[（(][^）)]{1,100}[）)]`, 'giu'),
  );
  if ((variants?.length ?? 0) >= 2) return true;
  const repeatedNames = description.match(new RegExp(escapeRegExp(name.trim()), 'giu'));
  const referencedWorks = description.match(/《[^《》\n]{1,120}》/gu);
  return (repeatedNames?.length ?? 0) >= 3 && (referencedWorks?.length ?? 0) >= 2;
};

const isPlausibleCharacterCandidateTitle = (title: string, name: string): boolean => {
  const normalizedTitle = normalize(title);
  const normalizedName = normalize(name);
  if (
    !normalizedName ||
    /[/\\#]/u.test(title) ||
    INDEX_PAGE_MARKER.test(title) ||
    NON_CHARACTER_PAGE_MARKER.test(title)
  ) {
    return false;
  }
  if (normalizedTitle === normalizedName) return true;
  if (
    normalizedTitle.includes(normalizedName) &&
    (/[·・]/u.test(title) ||
      (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{3,12}$/u.test(title) &&
        normalizedTitle.endsWith(normalizedName) &&
        [...normalizedTitle].length - [...normalizedName].length >= 1 &&
        [...normalizedTitle].length - [...normalizedName].length <= 4)) &&
    !/(的|之)(?:道具|信物|技能|皮肤|模型|列表)/u.test(title)
  ) {
    return true;
  }
  if (!normalizedTitle.startsWith(normalizedName)) return false;

  // Alternate encyclopedia titles may append a work or site label, for example
  // “刻晴（原神）” or “刻晴 | 原神 Wiki”. Free-form continuations such as
  // “凯尔希的中坚怪物” are not character profile pages.
  const suffix = normalizedTitle.slice(normalizedName.length).trim();
  return (
    /^[（(][^）)]{1,80}[）)]$/u.test(suffix) ||
    /^(?:[-–—|｜:：])\s*[^-–—|｜:：]{1,100}$/u.test(suffix)
  );
};

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

const readRssTag = (item: string, tag: string): string => {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'iu').exec(item);
  return match?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() ?? '';
};

const isAllowedSupplementalUrl = (value: string): URL | undefined => {
  try {
    const url = new URL(value.replaceAll('&amp;', '&'));
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !SUPPLEMENTAL_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    ) {
      return undefined;
    }
    url.hash = '';
    return url;
  } catch {
    return undefined;
  }
};

const isNonTextualMediaPage = (url: URL): boolean => {
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === 'youtu.be' ||
    hostname.endsWith('.youtube.com') ||
    hostname === 'youtube.com' ||
    hostname.endsWith('.nicovideo.jp') ||
    hostname === 'nicovideo.jp' ||
    ((hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com')) &&
      /^\/video(?:\/|$)/u.test(url.pathname))
  );
};

const describeWebSource = (url: URL): { label: string; priority: number } => {
  const hostname = url.hostname.toLowerCase();
  const matches = (domain: string): boolean =>
    hostname === domain || hostname.endsWith(`.${domain}`);
  if (matches('kurogame.com') || matches('hoyolab.com') || matches('miyoushe.com')) {
    return { label: '作品官方资料', priority: 50 };
  }
  if (matches('wiki.gg')) return { label: '专属社区 Wiki', priority: 45 };
  if (matches('fandom.com')) return { label: 'Fandom 社区 Wiki', priority: 44 };
  if (matches('biligame.com')) return { label: 'BWIKI', priority: 43 };
  if (matches('huijiwiki.com')) return { label: '灰机 Wiki', priority: 42 };
  if (matches('gamekee.com')) return { label: 'GameKee Wiki', priority: 41 };
  if (matches('evageeks.org')) return { label: '作品专题 Wiki', priority: 40 };
  if (matches('moegirl.org.cn')) return { label: '萌娘百科', priority: 35 };
  if (matches('baike.baidu.com')) return { label: '百度百科', priority: 34 };
  if (matches('wikipedia.org')) return { label: 'Wikipedia', priority: 30 };
  return { label: hostname, priority: 10 };
};

const selectRelevantText = (text: string, characterName: string, kind: WebSearchResult['kind']) => {
  const markers =
    kind === 'dialogue'
      ? [characterName, '台词', '语音', '对白', '名言', 'セリフ', 'ボイス']
      : kind === 'address'
        ? [characterName, '称呼', '叫法', '玩家', '主角', '呼び方', '主人公', 'プレイヤー']
        : [characterName, '身份', '背景', '性格', '关系', '角色'];
  return selectEvidenceText(text, markers, 2_500);
};

const PROFILE_EVIDENCE_MARKERS = [
  '性格',
  '人格',
  '人物关系',
  '重要关系',
  '关系',
  '称呼',
  '说话方式',
  '语言风格',
  '口头禅',
  '台词',
  '对白',
  '语音',
  'personality',
  'relationships',
  'relations',
  'speech',
  'quotes',
  'voice lines',
] as const;

const selectEvidenceText = (text: string, markers: readonly string[], maximum: number): string => {
  const cleaned = text
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
  if (cleaned.length <= maximum) return cleaned;

  const normalized = cleaned.toLowerCase();
  const ranges: Array<{ start: number; end: number }> = [
    { start: 0, end: Math.min(cleaned.length, Math.max(160, Math.floor(maximum * 0.2))) },
  ];
  for (const marker of markers) {
    const normalizedMarker = marker.toLowerCase();
    let searchFrom = 0;
    let matches = 0;
    while (matches < 3) {
      const position = normalized.indexOf(normalizedMarker, searchFrom);
      if (position < 0) break;
      ranges.push({
        start: Math.max(0, position - 160),
        end: Math.min(cleaned.length, position + Math.max(500, Math.floor(maximum * 0.34))),
      });
      searchFrom = position + normalizedMarker.length;
      matches += 1;
    }
  }

  const merged = ranges
    .sort((left, right) => left.start - right.start)
    .reduce<Array<{ start: number; end: number }>>((result, range) => {
      const previous = result.at(-1);
      if (previous && range.start <= previous.end + 80) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        result.push({ ...range });
      }
      return result;
    }, []);
  return merged
    .map(({ start, end }) => cleaned.slice(start, end).trim())
    .filter(Boolean)
    .join('\n\n[…相关章节…]\n\n')
    .slice(0, maximum);
};

const deduplicateResearchPages = (pages: ResearchPage[]): ResearchPage[] => {
  const byUrl = new Map<string, ResearchPage>();
  for (const page of pages) {
    const existing = byUrl.get(page.url);
    if (!existing || page.extract.length > existing.extract.length) byUrl.set(page.url, page);
  }
  return [...byUrl.values()];
};

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

const boundedRoleplayExamples = (
  value: unknown,
  validSourceIds: ReadonlySet<string>,
): CharacterRoleplayExample[] => {
  if (!Array.isArray(value)) return [];
  const examples: CharacterRoleplayExample[] = [];
  for (const item of value.slice(0, 20)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const scene = boundedChineseText(record.scene, 80);
    const emotion = boundedChineseText(record.emotion, 40);
    const trigger = boundedChineseText(record.trigger, 120);
    const attitude = boundedChineseText(record.attitude, 120);
    const line = boundedChineseText(record.line, 60);
    const sourceId = boundedString(record.sourceId, 100);
    if (!scene || !emotion || !trigger || !attitude || !line || !validSourceIds.has(sourceId)) {
      continue;
    }
    examples.push({ scene, emotion, trigger, attitude, line, sourceId });
  }
  return examples;
};

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
    case 'context-too-long':
      return '资料已找到，但公开资料超过了当前模型能处理的长度。可以重新整理，程序会继续使用精简后的资料。';
    case 'provider-response':
      return '资料已找到，但模型没有返回完整的结构化角色卡，可能是输出被截断或 JSON 格式有误。可以直接重新整理。';
    default:
      return '资料已找到，但模型返回的内容无法整理成角色设定。你可以重新整理或手动填写。';
  }
};

const boundedChineseText = (value: unknown, maximum: number): string => {
  const text = boundedString(value, maximum);
  if (!text || !/[\u3400-\u9fff]/u.test(text) || /\[source_\d+\]/iu.test(text)) return '';
  return text;
};

const boundedSpeechStyle = (value: unknown): string => {
  const text = boundedChineseText(value, 2_000);
  return sanitizeCharacterSpeechStyle(text);
};

const boundedUserDisplayName = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const displayName = value
    .normalize('NFKC')
    .trim()
    .replace(/^[“「『'"]|[”」』'"]$/gu, '');
  if (
    !displayName ||
    displayName.length > 20 ||
    /[，。；、！？,.!?;:\n]/u.test(displayName) ||
    /(?:较为|直接|语气|说话|称呼|用户|态度|时候)/u.test(displayName)
  ) {
    return '';
  }
  return displayName;
};

const WORK_USER_DISPLAY_NAMES: ReadonlyArray<{ hints: readonly string[]; displayName: string }> = [
  { hints: ['明日方舟', 'arknights'], displayName: '博士' },
  { hints: ['原神', 'genshin'], displayName: '旅行者' },
];

const inferUserDisplayName = (
  generatedDisplayName: unknown,
  speechStyle: string,
  sourceWork: string,
): string => {
  const generated = boundedUserDisplayName(generatedDisplayName);
  if (generated) return generated;
  const explicit =
    /(?:对用户(?:的)?称呼|称呼用户|称用户)(?:为|是|作|叫作)\s*[“「『'"]?([^，。；、！？\n“”「」『』'"]{1,20})/u.exec(
      speechStyle,
    )?.[1] ??
    /(?:对用户(?:的)?称呼|称呼用户|称用户)\s*[“「『'"]([^”」』'"]{1,20})[”」』'"]/u.exec(
      speechStyle,
    )?.[1];
  const explicitDisplayName = boundedUserDisplayName(explicit);
  if (explicitDisplayName) return explicitDisplayName;
  const normalizedWork = normalize(sourceWork);
  return (
    WORK_USER_DISPLAY_NAMES.find(({ hints }) =>
      hints.some((hint) => normalizedWork.includes(normalize(hint))),
    )?.displayName ?? DEFAULT_CHARACTER_PROFILE.userDisplayName
  );
};

const fallbackIncompleteSpeechStyle = (
  canonicalName: string,
  sourceWork: string,
  userDisplayName: string,
): string => {
  const normalizedName = normalize(canonicalName).replaceAll("'", '');
  const normalizedWork = normalize(sourceWork);
  if (
    (normalizedName === '凯尔希' || normalizedName === 'kaltsit') &&
    (normalizedWork.includes('明日方舟') || normalizedWork.includes('arknights'))
  ) {
    return KALTSIT_CHARACTER_PROFILE.lore?.speechStyle ?? `通常称用户为“${userDisplayName}”。`;
  }
  return `通常直接称用户为“${userDisplayName}”。`;
};

const buildProfileFields = (
  lore: Pick<CharacterLore, 'sourceWork' | 'identity' | 'personality' | 'speechStyle'>,
  generatedDisplayName?: unknown,
): CharacterResearchDraft['profileFields'] => ({
  userDisplayName: inferUserDisplayName(generatedDisplayName, lore.speechStyle, lore.sourceWork),
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
  const hasDetailPages = pages.some(
    (page) => /\/(file|dialogue|语音记录)$/iu.test(page.title) || DIALOGUE_MARKER.test(page.title),
  );
  const hasChineseVoicePage = pages.some((page) => /\/语音记录$/u.test(page.title));
  const prioritizedPages = pages
    .map((page, index) => ({ page, index }))
    .sort((left, right) => {
      const priority = (title: string): number =>
        /\/语音记录$/u.test(title)
          ? 4
          : /\/dialogue$/iu.test(title) || DIALOGUE_MARKER.test(title)
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
          : /\/dialogue$/iu.test(page.title) || DIALOGUE_MARKER.test(page.title)
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
      const normalizedExtract = page.extract
        .split(/\n\s*\n|\n(?=[A-Z][^\n]{0,50}:)/u)
        .map((part) => part.replace(/[ \t]+/g, ' ').trim())
        .filter(
          (part) =>
            part.length >= 4 &&
            !/^(navigation|this article|operator\s+file|干员信息|目录|导航)\b/iu.test(part),
        )
        .join('\n\n');
      const usefulText = selectEvidenceText(
        normalizedExtract,
        /\/(file|dialogue|语音记录)$/iu.test(page.title) || DIALOGUE_MARKER.test(page.title)
          ? ['台词', '对白', '语音', '称呼', 'dialogue', 'quotes', 'voice lines']
          : PROFILE_EVIDENCE_MARKERS,
        pageBudget,
      );
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
    private readonly generationTimeoutMs = DEFAULT_CHARACTER_LORE_GENERATION_TIMEOUT_MS,
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
      const regionalSources = SOURCES.filter((source) => source.id === 'moegirl-wiki');
      const preferredSources = [...new Set([...regionalSources, ...matchedSources])];
      const preferredSettled = await Promise.allSettled(
        preferredSources.map(async (source) => {
          const [searched, exact] = await Promise.all([
            this.searchSource(source, name, sourceWork, signal),
            this.lookupExactSource(source, name, sourceWork, signal),
          ]);
          return exact ? [...searched, exact] : searched;
        }),
      );
      collected.push(
        ...preferredSettled.flatMap((result) =>
          result.status === 'fulfilled' ? result.value : [],
        ),
      );
      if (signal.aborted) return [];
      if (collected.length === 0) {
        const generalSources = SOURCES.filter(
          (source) => source.workHints.length === 0 && !regionalSources.includes(source),
        );
        const settled = await Promise.allSettled(
          generalSources.map((source) => this.searchSource(source, name, sourceWork, signal)),
        );
        collected.push(
          ...settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
        );
      }
      const exact = collected
        .filter(({ record }) => normalize(record.candidate.name) === normalize(name))
        .sort((left, right) => right.score - left.score);
      if (exact.length > 0) return this.storeCandidates(exact.slice(0, 1));
      if (collected.length === 0) {
        try {
          collected.push(...(await this.searchWebCandidates(name, sourceWork, signal)));
        } catch {
          if (signal.aborted) return [];
          // Public web discovery is a fallback; an unavailable search provider is not fatal.
        }
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
      const [pages, supplementalPages, crossSourcePages] = await Promise.all([
        this.fetchPages(record, signal),
        this.discoverSupplementalPages(record, signal).catch((error) => {
          if (signal.aborted) throw error;
          return [];
        }),
        this.fetchCrossSourcePages(record, signal).catch((error) => {
          if (signal.aborted) throw error;
          return [];
        }),
      ]);
      const selectedPages = deduplicateResearchPages([
        ...pages,
        ...supplementalPages,
        ...crossSourcePages,
      ]).slice(0, 8);
      if (selectedPages.length === 0) {
        throw new Error('The selected character page is unavailable.');
      }
      const retrievedAt = Date.now();
      const sources = selectedPages.map((page, index) => ({
        id: `source_${index + 1}`,
        title: page.title,
        url: page.url,
        siteName: page.siteName,
        retrievedAt,
      }));
      const sourceText = selectSourceText(selectedPages);
      const fallback: Omit<CharacterLore, 'sources'> = {
        canonicalName: record.candidate.name,
        aliases: [],
        sourceWork: record.candidate.sourceWork,
        identity: '',
        personality: '',
        background: '',
        relationships: [],
        speechStyle: '',
        sampleLines: [],
        roleplayExamples: [],
      };
      let generated: CharacterLoreGenerationResult = {};
      const warnings: string[] = [];
      if (this.generator && sourceText) {
        const generationTimeoutMs = Math.max(
          1_000,
          Math.min(300_000, Math.trunc(this.generationTimeoutMs)),
        );
        const generationTimeout = AbortSignal.timeout(generationTimeoutMs);
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
              ? `资料已找到，但模型在 ${Math.ceil(generationTimeoutMs / 1_000)} 秒内没有完成整理。你可以直接重新整理或手动填写。`
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
      const rawSpeechStyle = boundedChineseText(generated.speechStyle, 2_000);
      let speechStyle = boundedSpeechStyle(rawSpeechStyle);
      if (!speechStyle && rawSpeechStyle) {
        const userDisplayName = inferUserDisplayName(
          generated.userDisplayName,
          '',
          fallback.sourceWork,
        );
        speechStyle = fallbackIncompleteSpeechStyle(
          fallback.canonicalName,
          fallback.sourceWork,
          userDisplayName,
        );
        warnings.push(
          '模型返回的说话方式不完整；已恢复能够确认的称呼规则，其他表达特点可以重新整理。',
        );
      }
      const sampleLines = boundedStrings(generated.sampleLines, 20, 40).filter(
        (item) => /[\u3400-\u9fff]/u.test(item) && !/\[source_\d+\]/iu.test(item),
      );
      const roleplayExamples = boundedRoleplayExamples(
        generated.roleplayExamples,
        new Set(sources.map(({ id }) => id)),
      );
      if (
        this.generator &&
        warnings.length === 0 &&
        !identity &&
        !personality &&
        !background &&
        relationships.length === 0 &&
        !speechStyle &&
        sampleLines.length === 0 &&
        roleplayExamples.length === 0
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
        sampleLines,
        roleplayExamples,
        sources,
      };
      return {
        lore,
        profileFields: buildProfileFields(lore, generated.userDisplayName),
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
      srlimit: '8',
      srnamespace: '0',
    }).toString();
    const body = await this.fetchJson<MediaWikiSearchResponse>(url, source, signal);
    const normalizedName = normalize(name);
    const normalizedWorkTerms = sourceWork
      .split(/[/|·（）()\s]+/u)
      .map(normalize)
      .filter((term) => term.length >= 2);
    return (body.query?.search ?? []).flatMap((item, index) => {
      if (typeof item.pageid !== 'number' || typeof item.title !== 'string') return [];
      const title = item.title.trim();
      if (!title) return [];
      const normalizedTitle = normalize(title);
      const exactName = normalizedTitle === normalizedName;
      const plausibleTitle = isPlausibleCharacterCandidateTitle(title, name);
      const decodedDescription = decodeSnippet(boundedString(item.snippet, 2_000));
      if (isLikelyDisambiguationPage(title, name, decodedDescription)) return [];
      const confirmsWork =
        workMatches ||
        normalizedWorkTerms.length === 0 ||
        normalizedWorkTerms.some((term) =>
          normalize(`${title} ${decodedDescription}`).includes(term),
        );
      // A work-wide index can mention the requested name in its body, but it is not the
      // requested character's profile and must not become a selectable candidate.
      if (!plausibleTitle || !confirmsWork) return [];
      const score = source.priority + (exactName ? 120 : 60 - index * 4) + (workMatches ? 100 : 0);
      const candidateId = `candidate_${randomUUID().replaceAll('-', '')}`;
      const sourceUrl = new URL(
        `${source.articlePath}${encodeURIComponent(title.replaceAll(' ', '_'))}`,
        source.origin,
      ).toString();
      const description = /\{\{|\}\}|\[\[/u.test(decodedDescription)
        ? `${source.label} 中的角色资料`
        : decodedDescription;
      const inferredWork = inferSourceWork({
        title,
        name,
        requestedWork: sourceWork,
        description: decodedDescription,
        canonicalWork: source.canonicalWork,
      });
      const candidate: CharacterResearchCandidate = {
        id: candidateId,
        name:
          normalize(title) !== normalizedName &&
          isPlausibleCharacterCandidateTitle(title, name) &&
          !parentheticalWorkForTitle(title, name, sourceWork) &&
          !delimitedWorkForTitle(title, name)
            ? title
            : inferredWork && normalize(title) !== normalizedName
              ? name.trim()
              : title,
        sourceWork: inferredWork,
        description,
        sourceName: source.label,
        sourceUrl,
        matchReason:
          workMatches && exactName
            ? `名称与“${sourceWork}”完全匹配`
            : inferredWork && !sourceWork
              ? `页面资料识别作品“${inferredWork}”`
              : inferredWork && normalize(title) !== normalizedName
                ? `页面标题同时匹配角色名和作品“${inferredWork}”`
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
            requestedName: name.trim(),
            source,
            pageId: item.pageid,
            title,
            expiresAt: Date.now() + CANDIDATE_TTL_MS,
          },
        },
      ];
    });
  }

  private async lookupExactSource(
    source: CharacterSourceDefinition,
    name: string,
    sourceWork: string,
    signal: AbortSignal,
  ): Promise<{ record: CandidateRecord; score: number } | undefined> {
    const url = new URL(source.apiPath, source.origin);
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'extracts|info',
      titles: name,
      exintro: '1',
      explaintext: '1',
      inprop: 'url',
      redirects: '1',
    }).toString();
    const body = await this.fetchJson<MediaWikiExtractResponse>(url, source, signal);
    const page = (body.query?.pages ?? []).find(
      (candidate) =>
        candidate.missing === undefined &&
        typeof candidate.pageid === 'number' &&
        typeof candidate.title === 'string',
    );
    if (!page || typeof page.pageid !== 'number' || typeof page.title !== 'string')
      return undefined;
    const title = page.title.trim();
    if (!isPlausibleCharacterCandidateTitle(title, name)) return undefined;
    const extract = decodeSnippet(boundedString(page.extract, 20_000));
    if (isLikelyDisambiguationPage(title, name, extract)) return undefined;
    const normalizedWorkTerms = sourceWork
      .split(/[/|·（）()\s]+/u)
      .map(normalize)
      .filter((term) => term.length >= 2);
    const workMatches = sourceMatchesWork(source, sourceWork);
    if (
      !workMatches &&
      normalizedWorkTerms.length > 0 &&
      !normalizedWorkTerms.some((term) => normalize(`${title} ${extract}`).includes(term))
    ) {
      return undefined;
    }
    const pageUrl = boundedString(page.fullurl, 2_000);
    let sourceUrl: URL;
    try {
      sourceUrl = pageUrl
        ? new URL(pageUrl)
        : new URL(
            `${source.articlePath}${encodeURIComponent(title.replaceAll(' ', '_'))}`,
            source.origin,
          );
    } catch {
      return undefined;
    }
    if (sourceUrl.protocol !== 'https:' || sourceUrl.origin !== source.origin) return undefined;
    const candidateId = `candidate_${randomUUID().replaceAll('-', '')}`;
    const inferredWork = inferSourceWork({
      title,
      name,
      requestedWork: sourceWork,
      description: extract,
      canonicalWork: source.canonicalWork,
    });
    return {
      score: source.priority + 240 + (workMatches ? 100 : 0),
      record: {
        candidate: {
          id: candidateId,
          name: title,
          sourceWork: inferredWork,
          description: extract.slice(0, 160) || `${source.label} 中的角色资料`,
          sourceName: source.label,
          sourceUrl: sourceUrl.toString(),
          matchReason: workMatches
            ? `“${sourceWork}”资料源中的精确角色页面`
            : sourceWork
              ? `精确页面正文同时匹配“${sourceWork}”`
              : inferredWork
                ? `精确页面正文识别作品“${inferredWork}”`
                : '精确页面与角色名匹配',
        },
        requestedName: name.trim(),
        source,
        pageId: page.pageid,
        title,
        expiresAt: Date.now() + CANDIDATE_TTL_MS,
      },
    };
  }

  private async discoverSupplementalPages(
    record: CandidateRecord,
    signal: AbortSignal,
  ): Promise<ResearchPage[]> {
    const name = record.candidate.name;
    const work = record.candidate.sourceWork;
    const searches = [
      { kind: 'profile' as const, query: `${name} ${work} 角色 身份 背景 性格 关系` },
      { kind: 'dialogue' as const, query: `${name} ${work} 台词 语音 对白 名言` },
      { kind: 'dialogue' as const, query: `${name} ${work} セリフ ボイス` },
      { kind: 'address' as const, query: `${name} ${work} 如何称呼 玩家 主角 叫法` },
    ];
    const settled = await Promise.allSettled(
      searches.map(({ query, kind }) => this.searchWeb(query, kind, signal)),
    );
    const normalizedName = normalize(name).replace(/\s*\([^)]*\)\s*$/u, '');
    const workTerms = work
      .split(/[/|·]/u)
      .map(normalize)
      .filter((term) => term.length >= 2);
    const unique = new Map<string, WebSearchResult>();
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      for (const item of result.value) {
        const haystack = normalize(`${item.title} ${item.description}`);
        const parsedUrl = isAllowedSupplementalUrl(item.url);
        if (!parsedUrl || isNonTextualMediaPage(parsedUrl)) continue;
        if (!haystack.includes(normalizedName)) continue;
        if (workTerms.length > 0 && !workTerms.some((term) => haystack.includes(term))) continue;
        if (item.kind === 'dialogue' && !DIALOGUE_MARKER.test(haystack)) continue;
        if (item.kind === 'address' && !ADDRESS_MARKER.test(haystack)) continue;
        if (
          item.kind === 'profile' &&
          !/(角色|人物|身份|背景|性格|关系|character|profile)/iu.test(haystack)
        ) {
          continue;
        }
        unique.set(item.url, item);
      }
    }

    const selected = [...unique.values()]
      .sort((left, right) => {
        const priority = (kind: WebSearchResult['kind']): number =>
          kind === 'address' ? 3 : kind === 'dialogue' ? 2 : 1;
        return priority(right.kind) - priority(left.kind);
      })
      .slice(0, 8);
    const fetched = await Promise.allSettled(
      selected.map((result) => this.fetchSupplementalPage(result, name, signal)),
    );
    return fetched.flatMap((result, index) => {
      if (result.status === 'fulfilled' && result.value) return [result.value];
      const fallback = selected[index];
      if (!fallback || fallback.description.length < 20) return [];
      const parsed = isAllowedSupplementalUrl(fallback.url);
      if (!parsed) return [];
      return [
        {
          title: `${fallback.kind === 'dialogue' ? '台词资料' : fallback.kind === 'address' ? '玩家称谓资料' : '角色资料'}：${fallback.title}`,
          url: parsed.toString(),
          extract: fallback.description,
          siteName: parsed.hostname,
        },
      ];
    });
  }

  private async searchWebCandidates(
    name: string,
    sourceWork: string,
    signal: AbortSignal,
  ): Promise<Array<{ record: CandidateRecord; score: number }>> {
    const query = [name, sourceWork, '角色资料'].filter(Boolean).join(' ');
    const results = await this.searchWeb(query, 'profile', signal);
    const workTerms = sourceWork
      .split(/[/|·（）()\s]+/u)
      .map(normalize)
      .filter((term) => term.length >= 2);
    return results.flatMap((result, index) => {
      const haystack = normalize(`${result.title} ${result.description}`);
      if (
        !isPlausibleCharacterCandidateTitle(result.title, name) ||
        (workTerms.length > 0 && !workTerms.some((term) => haystack.includes(term)))
      ) {
        return [];
      }
      const sourceUrl = isAllowedSupplementalUrl(result.url);
      if (!sourceUrl) return [];
      const sourceDetails = describeWebSource(sourceUrl);
      const candidateId = `candidate_${randomUUID().replaceAll('-', '')}`;
      const inferredWork = inferSourceWork({
        title: result.title,
        name,
        requestedWork: sourceWork,
        description: result.description,
      });
      const candidate: CharacterResearchCandidate = {
        id: candidateId,
        name: name.trim(),
        sourceWork: inferredWork,
        description: result.description,
        sourceName: sourceDetails.label,
        sourceUrl: sourceUrl.toString(),
        matchReason: sourceWork
          ? `网页标题包含角色名，摘要同时匹配“${sourceWork}”`
          : inferredWork
            ? `网页资料识别作品“${inferredWork}”`
            : '网页标题与角色名匹配',
      };
      return [
        {
          score: sourceDetails.priority * 10 - index * 2,
          record: {
            candidate,
            requestedName: name.trim(),
            title: result.title,
            webResult: result,
            expiresAt: Date.now() + CANDIDATE_TTL_MS,
          },
        },
      ];
    });
  }

  private async searchWeb(
    query: string,
    kind: WebSearchResult['kind'],
    signal: AbortSignal,
  ): Promise<WebSearchResult[]> {
    const url = new URL(WEB_SEARCH_PATH, WEB_SEARCH_ORIGIN);
    url.search = new URLSearchParams({ q: query }).toString();
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await this.fetcher(url, {
      headers: {
        accept: 'text/html, application/rss+xml, application/xml;q=0.9, text/plain;q=0.8',
        'user-agent': USER_AGENT,
      },
      redirect: 'error',
      signal: AbortSignal.any([signal, timeoutSignal]),
    });
    if (!response.ok) throw new Error(`Character web search returned ${response.status}.`);
    if (response.url && new URL(response.url).origin !== WEB_SEARCH_ORIGIN) {
      throw new Error('The character web search origin is invalid.');
    }
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_RESPONSE_CHARACTERS) {
      throw new Error('The character web search response is too large.');
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (
      contentType &&
      !contentType.includes('text/html') &&
      !contentType.includes('xml') &&
      !contentType.includes('text/plain')
    ) {
      throw new Error('The character web search response type is invalid.');
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARACTERS) {
      throw new Error('The character web search response is too large.');
    }
    if (contentType.includes('text/html')) {
      return [
        ...text.matchAll(
          /<div\s+class="result\s+results_links[\s\S]*?<div\s+class="clear"><\/div>/giu,
        ),
      ]
        .flatMap((match) => {
          const block = match[0];
          const link = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/iu.exec(block);
          if (!link) return [];
          const parsed = this.unwrapWebSearchUrl(link[1] ?? '');
          const title = decodeSnippet(link[2] ?? '').slice(0, 300);
          const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/iu.exec(block)?.[1] ?? '';
          const description = decodeSnippet(snippet).slice(0, 500);
          return title && parsed ? [{ title, url: parsed.toString(), description, kind }] : [];
        })
        .slice(0, 15);
    }
    return [...text.matchAll(/<item>([\s\S]*?)<\/item>/giu)].flatMap((match) => {
      const item = match[1] ?? '';
      const title = decodeSnippet(readRssTag(item, 'title'));
      const parsed = isAllowedSupplementalUrl(readRssTag(item, 'link'));
      const description = htmlToPlainText(readRssTag(item, 'description')).slice(0, 500);
      return title && parsed ? [{ title, url: parsed.toString(), description, kind }] : [];
    });
  }

  private unwrapWebSearchUrl(value: string): URL | undefined {
    try {
      const redirect = new URL(value.replaceAll('&amp;', '&'), 'https://duckduckgo.com');
      const target =
        (redirect.hostname === 'duckduckgo.com' || redirect.hostname.endsWith('.duckduckgo.com')) &&
        redirect.pathname === '/l/'
          ? redirect.searchParams.get('uddg')
          : redirect.toString();
      return target ? isAllowedSupplementalUrl(target) : undefined;
    } catch {
      return undefined;
    }
  }

  private async fetchSupplementalPage(
    result: WebSearchResult,
    characterName: string,
    signal: AbortSignal,
  ): Promise<ResearchPage | undefined> {
    const url = isAllowedSupplementalUrl(result.url);
    if (!url) return undefined;
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await this.fetcher(url, {
      headers: { accept: 'text/html, text/plain;q=0.9', 'user-agent': USER_AGENT },
      redirect: 'error',
      signal: AbortSignal.any([signal, timeoutSignal]),
    });
    if (!response.ok) return undefined;
    if (response.url) {
      const finalUrl = isAllowedSupplementalUrl(response.url);
      if (!finalUrl || finalUrl.origin !== url.origin) return undefined;
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType && !contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return undefined;
    }
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_RESPONSE_CHARACTERS) return undefined;
    const body = await response.text();
    if (body.length > MAX_RESPONSE_CHARACTERS) return undefined;
    const plainText = selectRelevantText(htmlToPlainText(body), characterName, result.kind);
    const extract = [result.description, plainText].filter(Boolean).join('\n\n').slice(0, 2_500);
    if (extract.length < 20 || !normalize(extract).includes(normalize(characterName))) {
      return undefined;
    }
    return {
      title: `${result.kind === 'dialogue' ? '台词资料' : result.kind === 'address' ? '玩家称谓资料' : '角色资料'}：${result.title}`,
      url: url.toString(),
      extract,
      siteName: url.hostname,
    };
  }

  private async fetchPages(record: CandidateRecord, signal: AbortSignal): Promise<ResearchPage[]> {
    if (record.webResult) {
      const page = await this.fetchSupplementalPage(
        record.webResult,
        record.candidate.name,
        signal,
      );
      return page ? [page] : [];
    }
    const source = record.source;
    if (!source) return [];
    const titles = [
      record.title,
      ...source.detailSuffixes.map((suffix) => `${record.title}${suffix}`),
    ];
    const url = new URL(source.apiPath, source.origin);
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
    const body = await this.fetchJson<MediaWikiExtractResponse>(url, source, signal);
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
      if (parsed.protocol !== 'https:' || parsed.origin !== source.origin) return [];
      return [{ title, url: parsed.toString(), extract, siteName: source.label }];
    });
    const includedTitles = new Set(extracted.map((page) => page.title));
    const missingDetails = titles.slice(1).filter((title) => !includedTitles.has(title));
    const parseTitles = [...missingDetails, ...(source.parseMainPage ? [record.title] : [])];
    const parsedDetails = await Promise.allSettled(
      parseTitles.map((title) => this.fetchParsedPage(source, title, signal)),
    );
    const combined: Array<{ title: string; url: string; extract: string; siteName: string }> = [
      ...extracted,
      ...parsedDetails.flatMap((result) =>
        result.status === 'fulfilled' && result.value ? [result.value] : [],
      ),
    ];
    if (source.id === 'arknights-terra-wiki') {
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

  private async fetchCrossSourcePages(
    record: CandidateRecord,
    signal: AbortSignal,
  ): Promise<ResearchPage[]> {
    const sources = SOURCES.filter(
      (source) => source.workHints.length === 0 && source.id !== record.source?.id,
    );
    const settled = await Promise.allSettled(
      sources.map(async (source) => {
        const [searched, exact] = await Promise.all([
          this.searchSource(source, record.requestedName, record.candidate.sourceWork, signal),
          this.lookupExactSource(source, record.requestedName, record.candidate.sourceWork, signal),
        ]);
        const best = exact ?? searched.sort((left, right) => right.score - left.score)[0];
        return best ? this.fetchPages(best.record, signal) : [];
      }),
    );
    return settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
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
