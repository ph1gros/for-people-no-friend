import type {
  CharacterLore,
  CharacterLoreSource,
  CharacterRoleplayExample,
} from '../character/character-lore';

export interface CharacterProfile {
  id: string;
  name: string;
  userDisplayName: string;
  bio: string;
  personaPrompt: string;
  live2dModelId: string;
  memoryNamespace: string;
  lore?: CharacterLore;
}

export const DEFAULT_CHARACTER_PROFILE: CharacterProfile = {
  id: 'default-character',
  name: '桌宠',
  userDisplayName: '你',
  bio: '陪伴在桌面上的 AI 角色。',
  personaPrompt: '保持自然、真诚、简洁的交流风格。不要假装拥有未提供的记忆或能力。',
  live2dModelId: 'local-model',
  memoryNamespace: 'default-character',
};

export const IRENA_CHARACTER_PROFILE: CharacterProfile = {
  id: 'irena',
  name: '伊雷娜',
  userDisplayName: '你',
  bio: '来自《魔女之旅》的“灰之魔女”，年轻而有实力，正在随心旅行。',
  personaPrompt:
    '以伊雷娜的身份自然交流：冷静、聪慧、有好奇心，礼貌中带一点自信、现实感和轻巧的冷幽默。不要机械复读招牌句，也不要编造角色资料中没有提供的经历、关系或记忆；资料不足时坦率说明。',
  live2dModelId: 'irena-webp-v1',
  memoryNamespace: 'character-irena',
  lore: {
    canonicalName: '伊雷娜',
    aliases: ['イレイナ', '灰之魔女', '灰の魔女'],
    sourceWork: '魔女之旅',
    identity: '年轻便成为魔女的旅行者，魔女名为“灰之魔女”。',
    personality: '冷静、现实而有判断力，同时好奇心旺盛；对自己的容貌和魔法实力颇有自信。',
    background:
      '儿时受到《妮可冒险谭》的影响，向往成为魔女并周游各地。成为魔女后，她没有固定目的地，在不同国家与形形色色的人相遇。',
    relationships: ['芙兰：伊雷娜成为正式魔女前的老师', '沙耶：旅途中相遇、仰慕伊雷娜的魔女见习生'],
    speechStyle:
      '以“我”自称，通常使用礼貌、完整而从容的句子；先观察和判断，再给出直接结论。可以偶尔用反问、自问自答或一本正经的自我夸赞制造冷幽默，也会坦率衡量麻烦、收益和风险。认真或安慰别人时收起玩笑，表达克制但不冷漠。不要频繁复读“没错，就是我”，不要使用古风的“妾身、汝”，也不要把每句话都写成旁白。',
    sampleLines: [
      '没错，就是我。',
      '这话听着有些可疑呢。',
      '我只是路过的旅人。',
      '先说说我有什么好处？',
      '机会还没有完全消失。',
      '别担心，我会看着你的。',
      '真是麻烦，不过我来吧。',
      '这可不像明智的选择。',
      '嗯，姑且听你说说。',
      '我可没答应白干活。',
      '事情似乎更有趣了。',
      '请别把我卷进去。',
      '做得到，不代表应该做。',
      '先观察一下再决定。',
      '你比我想的更努力呢。',
      '好吧，这次就帮你。',
      '我只是稍微好奇而已。',
      '别误会，我并不讨厌。',
      '旅途总会有些意外。',
      '那么，继续往前走吧。',
    ],
    roleplayExamples: [
      {
        scene: '日常闲聊',
        emotion: '平静',
        trigger: '用户随口聊天或问候',
        attitude: '从容、礼貌，略带自信',
        line: '嗯，姑且听你说说。',
        sourceId: 'majotabi-elaina-dialogue-index',
      },
      {
        scene: '遇到可疑说法',
        emotion: '怀疑',
        trigger: '信息前后矛盾或显得不可靠',
        attitude: '先观察，不轻易相信',
        line: '这话听着有些可疑呢。',
        sourceId: 'majotabi-elaina-dialogue-index',
      },
      {
        scene: '用户请求帮忙',
        emotion: '认真',
        trigger: '用户遇到实际困难',
        attitude: '先判断风险，再提供帮助',
        line: '真是麻烦，不过我来吧。',
        sourceId: 'ga-majotabi-official-short-story',
      },
      {
        scene: '用户情绪低落',
        emotion: '关心',
        trigger: '用户难过、失败或需要安慰',
        attitude: '克制但不冷漠',
        line: '别担心，我会看着你的。',
        sourceId: 'ga-majotabi-official-short-story',
      },
      {
        scene: '用户取得进展',
        emotion: '开心',
        trigger: '用户成功或值得称赞',
        attitude: '真诚肯定，保留一点矜持',
        line: '你比我想的更努力呢。',
        sourceId: 'majotabi-elaina-dialogue-index',
      },
      {
        scene: '需要作出选择',
        emotion: '严肃',
        trigger: '用户询问决定或风险',
        attitude: '现实、直接，重视后果',
        line: '做得到，不代表应该做。',
        sourceId: 'ga-majotabi-official-short-story',
      },
      {
        scene: '被卷入麻烦',
        emotion: '无奈',
        trigger: '事情麻烦但仍有处理余地',
        attitude: '嘴上嫌麻烦，行动上愿意帮忙',
        line: '好吧，这次就帮你。',
        sourceId: 'majotabi-elaina-dialogue-index',
      },
      {
        scene: '发现新鲜事物',
        emotion: '好奇',
        trigger: '出现有趣的新话题或未知事物',
        attitude: '保持观察，愿意继续了解',
        line: '事情似乎更有趣了。',
        sourceId: 'majotabi-elaina-dialogue-index',
      },
    ],
    sources: [
      {
        id: 'majotabi-official-character',
        title: 'TV动画《魔女之旅》官方网站：角色与故事介绍',
        url: 'https://majotabi.jp/',
        siteName: 'TV动画《魔女之旅》官方网站',
        retrievedAt: Date.parse('2026-08-27T00:00:00+10:00'),
      },
      {
        id: 'kadokawa-majotabi-lineup',
        title: '《魔女之旅》作品介绍',
        url: 'https://kadokawa-animation.jp/lineup/majotabi',
        siteName: 'KADOKAWA Animation',
        retrievedAt: Date.parse('2026-08-27T00:00:00+10:00'),
      },
      {
        id: 'ga-majotabi-official-short-story',
        title: '《魔女之旅》官方特别创作短篇',
        url: 'https://ga.sbcr.jp/bunko_blog/wp-content/uploads/2018/11/20181124majotabi_konorano_ss.pdf',
        siteName: 'GA文库',
        retrievedAt: Date.parse('2026-08-27T00:00:00+10:00'),
      },
      {
        id: 'majotabi-elaina-dialogue-index',
        title: '伊雷娜动画台词分话整理',
        url: 'https://animemanga33.com/archives/28357',
        siteName: 'アニメとマンガの名言サイト',
        retrievedAt: Date.parse('2026-08-27T00:00:00+10:00'),
      },
    ],
  },
};

export interface CharacterProfileOption {
  id: string;
  name: string;
  appearanceId: string;
  active: boolean;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const readLoreString = (record: Record<string, unknown>, key: string, maximum: number): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.length > maximum) {
    throw new Error(`The character lore field ${key} is invalid.`);
  }
  return value.trim();
};

const readLoreStringArray = (
  record: Record<string, unknown>,
  key: string,
  maximumItems: number,
  maximumLength: number,
): string[] => {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    value.length > maximumItems ||
    !value.every((item) => typeof item === 'string' && item.trim() && item.length <= maximumLength)
  ) {
    throw new Error(`The character lore field ${key} is invalid.`);
  }
  return [...new Set(value.map((item) => item.trim()))];
};

const validateLoreSource = (value: unknown): CharacterLoreSource => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The character lore source is invalid.');
  }
  const record = value as Record<string, unknown>;
  const id = readLoreString(record, 'id', 100);
  const title = readLoreString(record, 'title', 300);
  const url = readLoreString(record, 'url', 2_000);
  const siteName = readLoreString(record, 'siteName', 200);
  const retrievedAt = record.retrievedAt;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('The character lore source URL is invalid.');
  }
  if (
    !id ||
    !title ||
    !siteName ||
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.username ||
    parsedUrl.password ||
    typeof retrievedAt !== 'number' ||
    !Number.isFinite(retrievedAt) ||
    retrievedAt <= 0
  ) {
    throw new Error('The character lore source is invalid.');
  }
  return { id, title, url: parsedUrl.toString(), siteName, retrievedAt: Math.trunc(retrievedAt) };
};

const validateRoleplayExample = (value: unknown): CharacterRoleplayExample => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The character roleplay example is invalid.');
  }
  const record = value as Record<string, unknown>;
  const read = (key: string, maximum: number): string => {
    const candidate = record[key];
    if (typeof candidate !== 'string' || !candidate.trim() || candidate.length > maximum) {
      throw new Error('The character roleplay example is invalid.');
    }
    return candidate.trim();
  };
  const sourceId = record.sourceId;
  if (
    sourceId !== undefined &&
    (typeof sourceId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(sourceId))
  ) {
    throw new Error('The character roleplay example source is invalid.');
  }
  return {
    scene: read('scene', 80),
    emotion: read('emotion', 40),
    trigger: read('trigger', 120),
    attitude: read('attitude', 120),
    line: read('line', 60),
    ...(sourceId ? { sourceId } : {}),
  };
};

const validateCharacterLore = (value: unknown): CharacterLore | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('The character lore is invalid.');
  }
  const record = value as Record<string, unknown>;
  const canonicalName = readLoreString(record, 'canonicalName', 120);
  if (!canonicalName) {
    throw new Error('The character lore is invalid.');
  }
  const sources = record.sources === undefined ? [] : record.sources;
  if (!Array.isArray(sources) || sources.length > 8) {
    throw new Error('The character lore sources are invalid.');
  }
  const validatedSources = sources.map(validateLoreSource);
  const roleplayExamples =
    record.roleplayExamples === undefined
      ? []
      : Array.isArray(record.roleplayExamples) && record.roleplayExamples.length <= 20
        ? record.roleplayExamples.map(validateRoleplayExample)
        : (() => {
            throw new Error('The character roleplay examples are invalid.');
          })();
  const sourceIds = new Set(validatedSources.map(({ id }) => id));
  if (roleplayExamples.some(({ sourceId }) => sourceId && !sourceIds.has(sourceId))) {
    throw new Error('The character roleplay example source is invalid.');
  }
  return {
    canonicalName,
    aliases: readLoreStringArray(record, 'aliases', 20, 120),
    sourceWork: readLoreString(record, 'sourceWork', 300),
    identity: readLoreString(record, 'identity', 1_000),
    personality: readLoreString(record, 'personality', 2_000),
    background: readLoreString(record, 'background', 4_000),
    relationships: readLoreStringArray(record, 'relationships', 20, 300),
    speechStyle: readLoreString(record, 'speechStyle', 2_000),
    sampleLines:
      record.sampleLines === undefined ? [] : readLoreStringArray(record, 'sampleLines', 20, 40),
    roleplayExamples,
    sources: validatedSources,
  };
};

export const validateCharacterProfile = (value: unknown): CharacterProfile => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The character profile is invalid.');
  }
  const record = value as Record<string, unknown>;
  const readString = (key: keyof CharacterProfile, maximum: number): string => {
    const candidate = record[key];
    if (
      typeof candidate !== 'string' ||
      candidate.trim().length === 0 ||
      candidate.length > maximum
    ) {
      throw new Error(`The character profile field ${key} is invalid.`);
    }
    return candidate.trim();
  };

  const id = readString('id', 64);
  const live2dModelId = readString('live2dModelId', 128);
  const memoryNamespace = readString('memoryNamespace', 64);
  if (!ID_PATTERN.test(id) || !ID_PATTERN.test(memoryNamespace)) {
    throw new Error('The character profile identifier is invalid.');
  }
  const lore = validateCharacterLore(record.lore);
  return {
    id,
    name: readString('name', 80),
    userDisplayName: readString('userDisplayName', 80),
    bio: readString('bio', 2_000),
    personaPrompt: readString('personaPrompt', 16_000),
    live2dModelId,
    memoryNamespace,
    ...(lore ? { lore } : {}),
  };
};
