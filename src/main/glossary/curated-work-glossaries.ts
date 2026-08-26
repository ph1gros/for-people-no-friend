import type { WorkGlossaryEntry } from '../../core/conversation/work-glossary';

export interface CuratedWorkGlossary {
  id: string;
  displayName: string;
  entries: Array<WorkGlossaryEntry & { evidence: string[] }>;
}

const verifiedAt = Date.parse('2026-08-25T00:00:00+10:00');

export const CURATED_WORK_GLOSSARIES: readonly CuratedWorkGlossary[] = [
  {
    id: 'arknights',
    displayName: '明日方舟',
    entries: [
      {
        term: '325',
        aliases: ['325大学习', '1周'],
        meaning:
          '明日方舟集成战略民间赛事“仙术杯”第五届的低分梗：选手“魔法Zc目录”一局结算的游戏内分数为325，后来被玩家当作低分计量单位“周”，也衍生出“325大学习”等说法。',
        originContext:
          '源于仙术杯第五届相关赛程与社区二创。赛事总分还包含额外加分，因此资料中也会出现395；解释时应明确325指游戏内结算分，避免混为同一口径。',
        sources: [
          {
            title: '低分梗',
            url: 'https://akp.fandom.com/zh/wiki/%E4%BD%8E%E5%88%86%E6%A2%97',
            siteName: '粥批手册',
          },
          {
            title: '明日方舟仙术杯',
            url: 'https://moegirl.icu/zh-hans/%E6%98%8E%E6%97%A5%E6%96%B9%E8%88%9F%E4%BB%99%E6%9C%AF%E6%9D%AF',
            siteName: '萌娘百科',
          },
          {
            title: '仙术杯·梗百科',
            url: 'https://www.bilibili.com/opus/1010752946069045251',
            siteName: '哔哩哔哩社区',
          },
        ],
        lastVerified: verifiedAt,
        confidence: 0.93,
        evidence: ['325', '魔法zc目录'],
      },
    ],
  },
  {
    id: 'wandering-witch',
    displayName: '魔女之旅',
    entries: [
      {
        term: '灰之魔女',
        aliases: ['灰の魔女', 'Ashen Witch'],
        meaning: '伊雷娜成为正式魔女后使用的魔女名，与她灰色的头发相呼应。',
        originContext: '作品内正式称号，不是玩家给伊雷娜起的外号。',
        sources: [
          {
            title: 'TV 动画《魔女之旅》官方网站',
            url: 'https://majotabi.jp/',
            siteName: '《魔女之旅》动画官网',
          },
        ],
        lastVerified: verifiedAt,
        confidence: 0.95,
        evidence: ['灰の魔女', 'イレイナ'],
      },
      {
        term: '妮可冒险谭',
        aliases: ['ニケの冒険譚', '妮可的冒险故事'],
        meaning: '伊雷娜儿时喜爱的旅行故事，也是她向往周游各地的重要起点。',
        originContext: '作品内书名；中文译名可能因版本而略有不同，因此同时保留日文原名。',
        sources: [
          {
            title: 'TV 动画《魔女之旅》官方网站',
            url: 'https://majotabi.jp/',
            siteName: '《魔女之旅》动画官网',
          },
        ],
        lastVerified: verifiedAt,
        confidence: 0.94,
        evidence: ['ニケの冒険譚', 'イレイナ'],
      },
      {
        term: '星尘魔女',
        aliases: ['星屑の魔女'],
        meaning: '芙兰使用的魔女名；芙兰后来成为伊雷娜取得正式魔女资格前的老师。',
        originContext: '作品内正式称号与人物关系，不是泛指会使用星尘魔法的魔女。',
        sources: [
          {
            title: 'TV 动画《魔女之旅》官方网站',
            url: 'https://majotabi.jp/',
            siteName: '《魔女之旅》动画官网',
          },
        ],
        lastVerified: verifiedAt,
        confidence: 0.94,
        evidence: ['星屑の魔女', 'フラン'],
      },
      {
        term: '魔法统筹协会',
        aliases: ['魔法統括協会'],
        meaning: '作品中的魔法组织；席拉是隶属于该协会的干练调查员。',
        originContext: '作品内组织名称；遇到不同中文译名时应结合日文原名确认。',
        sources: [
          {
            title: 'TV 动画《魔女之旅》官方网站',
            url: 'https://majotabi.jp/',
            siteName: '《魔女之旅》动画官网',
          },
        ],
        lastVerified: verifiedAt,
        confidence: 0.93,
        evidence: ['魔法統括協会', 'シーラ'],
      },
    ],
  },
];
