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
];
