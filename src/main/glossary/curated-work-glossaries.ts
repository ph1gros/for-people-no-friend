import type { WorkGlossaryEntry } from '../../core/conversation/work-glossary';

export interface CuratedWorkGlossary {
  id: string;
  displayName: string;
  entries: Array<WorkGlossaryEntry & { evidence: string[] }>;
  onlineSources?: Array<{
    title: string;
    pageUrl: string;
    mediaWikiApiUrl: string;
    mediaWikiTitle: string;
  }>;
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
    id: 'delta-force',
    displayName: '三角洲行动',
    onlineSources: [
      {
        title: '三角洲行动/梗',
        pageUrl: 'https://moegirl.icu/%E4%B8%89%E8%A7%92%E6%B4%B2%E8%A1%8C%E5%8A%A8/%E6%A2%97',
        mediaWikiApiUrl: 'https://moegirl.icu/api.php',
        mediaWikiTitle: '三角洲行动/梗',
      },
    ],
    entries: [
      {
        term: '78主播',
        aliases: ['78', '787878', '78鼠鼠', '78点位'],
        meaning:
          '一般指主播老飞宇66。“78”来自“技霸”的谐音，并衍生出78点位、78传媒、78鼠鼠等社区说法；连续写成“787878”通常是在重复刷这个称呼。',
        originContext:
          '《三角洲行动》玩家社群对老飞宇66及其相关直播、点位和粉丝文化的称呼，不是游戏内数值或兑换码。',
        sources: [
          {
            title: '三角洲行动/梗：78主播',
            url: 'https://moegirl.icu/%E4%B8%89%E8%A7%92%E6%B4%B2%E8%A1%8C%E5%8A%A8/%E6%A2%97',
            siteName: '萌娘百科',
          },
        ],
        lastVerified: verifiedAt,
        confidence: 0.9,
        evidence: ['78主播', '老飞宇66'],
      },
      {
        term: '花来',
        aliases: ['花来士', '头甲枪胸挂背包花来'],
        meaning:
          '夺舍流玩家击倒目标、迅速换走其装备后，使用红狼“蚀金玫瑰”外观的大招捏碎金色玫瑰并加速撤离的口令和仪式化说法。',
        originContext:
          '《三角洲行动》夺舍流社区梗，常与“头、甲、枪、胸挂、背包，花来”连用；不是角色世界观中的正式术语。',
        sources: [
          {
            title: '三角洲行动/梗：夺舍流',
            url: 'https://moegirl.icu/%E4%B8%89%E8%A7%92%E6%B4%B2%E8%A1%8C%E5%8A%A8/%E6%A2%97',
            siteName: '萌娘百科',
          },
        ],
        lastVerified: verifiedAt,
        confidence: 0.9,
        evidence: ['花来', '蚀金玫瑰'],
      },
      {
        term: '我的箭下全是秘密',
        aliases: ['箭下全是秘密', '我的箭下没有秘密'],
        meaning:
          '把露娜相关宣传语“我的箭下没有秘密”反转后的社区调侃，常用来吐槽侦察箭存在扫描死角、没有发现敌人或提供的信息不够可靠。',
        originContext:
          '《三角洲行动》露娜相关二创梗；“没有秘密”是原句，“全是秘密”是玩家反向改写，角色扮演时应按上下文区分。',
        sources: [
          {
            title: '“我的箭下全是秘密”社区二创',
            url: 'https://www.bilibili.com/video/BV1UxKZzGEhs/',
            siteName: '哔哩哔哩社区',
          },
        ],
        lastVerified: verifiedAt,
        confidence: 0.78,
        evidence: ['我的箭下全是秘密'],
      },
    ],
  },
];
