import {
  SPEECH_ASSET_TIER_IDS,
  type SpeechAssetDownloadStatus,
  type SpeechAssetTierId,
} from './speech-asset-ipc';

/** Display metadata only. Installation authority remains in the application-owned pins. */
export const RESOURCE_CATEGORIES = {
  engine: '引擎',
  base: '基础模型',
  voice: '音色模型',
  recognition: '语音识别',
} as const;
export type ResourceCatalogId = SpeechAssetTierId;
export const RESOURCE_DEFINITIONS: Record<
  ResourceCatalogId,
  {
    category: keyof typeof RESOURCE_CATEGORIES;
    compatibility: string;
    language: string;
    dependencies: readonly SpeechAssetTierId[];
    installTier: SpeechAssetTierId | null;
    usageRestriction?: string;
  }
> = {
  'voice-runtime': {
    category: 'engine',
    compatibility: 'Style-Bert-VITS2',
    language: '日语',
    dependencies: ['bert-japanese', 'voice-ireina'],
    installTier: 'voice-runtime',
  },
  'genie-tts': {
    category: 'engine',
    compatibility: 'Genie-TTS（GPT-SoVITS ONNX）',
    language: '日语（当前配套音色）',
    dependencies: ['genie-data', 'voice-genie-mika'],
    installTier: 'genie-tts',
  },
  'genie-data': {
    category: 'base',
    compatibility: 'Genie-TTS',
    language: '与配套音色一致',
    dependencies: ['genie-tts'],
    installTier: 'genie-data',
  },
  'voice-genie-mika': {
    category: 'voice',
    compatibility: 'Genie-TTS（V2ProPlus）',
    language: '日语',
    dependencies: ['genie-tts', 'genie-data'],
    installTier: 'voice-genie-mika',
    usageRestriction: '上游示例音色；角色及声音相关权利归原权利人，使用须遵守随附说明。',
  },
  'bert-japanese': {
    category: 'base',
    compatibility: 'Style-Bert-VITS2',
    language: '日语',
    dependencies: ['voice-runtime'],
    installTier: 'bert-japanese',
  },
  'voice-ireina': {
    category: 'voice',
    compatibility: 'Style-Bert-VITS2',
    language: '日语',
    dependencies: ['voice-runtime', 'bert-japanese'],
    installTier: 'voice-ireina',
    usageRestriction: '仅限非商业使用；复制、分享和再分发时须保留随附使用说明',
  },
  'speech-input': {
    category: 'recognition',
    compatibility: 'sherpa-onnx（主程序内置）',
    language: '中文为主，支持多语言识别',
    dependencies: [],
    installTier: 'speech-input',
  },
};
const RESOURCE_IDS: readonly ResourceCatalogId[] = SPEECH_ASSET_TIER_IDS;
export interface ResourceCatalogEntry {
  id: ResourceCatalogId;
  name: string;
  summary: string;
  license: string;
  latestVersion: string | null;
}

export interface ResourceCatalog {
  schemaVersion: 1;
  resources: ResourceCatalogEntry[];
}

export interface ResourceCenterStatus {
  catalog: ResourceCatalog;
  catalogSource: 'bundled' | 'remote';
  catalogMessage?: string;
  checkedAt?: string;
  downloads: SpeechAssetDownloadStatus;
}

export const BUNDLED_RESOURCE_CATALOG: ResourceCatalog = {
  schemaVersion: 1,
  resources: [
    {
      id: 'voice-runtime',
      name: 'Style-Bert-VITS2 引擎',
      summary: '将文字合成为语音，提供 Style-Bert-VITS2 推理程序与独立运行环境。',
      license: 'AGPL-3.0；部分模块 LGPL-3.0；依赖按各自许可',
      latestVersion: '1.0.0',
    },
    {
      id: 'genie-tts',
      name: 'Genie-TTS 引擎',
      summary: '将文字合成为语音，提供 Genie-TTS 推理程序与独立运行环境。',
      license: '引擎 MIT；依赖和模型按各自许可',
      latestVersion: '1.0.1',
    },
    {
      id: 'genie-data',
      name: 'Genie 基础模型',
      summary: '为语音合成提供参考音频特征，帮助引擎理解发音与说话人信息，不决定角色音色。',
      license: '上游资源仓库标注 MIT；保留来源及第三方权利说明',
      latestVersion: '1.0.0',
    },
    {
      id: 'voice-genie-mika',
      name: '圣园未花（Mika）音色',
      summary: '提供圣园未花（Mika）的日语音色，决定角色发声特征；角色出自《蔚蓝档案》。',
      license: '上游仓库标注 MIT；角色及声音权利另行适用，见随附说明',
      latestVersion: '1.0.0',
    },
    {
      id: 'bert-japanese',
      name: '日语 DeBERTa 基础模型',
      summary: '为语音合成提供日语文本特征，帮助引擎理解读音与上下文，不决定角色音色。',
      license: 'CC BY-SA 4.0；保留署名、来源和修改说明',
      latestVersion: '1.0.0',
    },
    {
      id: 'voice-ireina',
      name: '伊蕾娜音色模型',
      summary: '提供伊蕾娜（Ireina）的日语音色，决定角色发声特征；角色出自《魔女之旅》。',
      license: '仅限非商业使用；须保留随附使用说明',
      latestVersion: '1.0.0',
    },
    {
      id: 'speech-input',
      name: 'SenseVoiceSmall 语音识别模型',
      summary: '将录音转换为文字，提供 SenseVoiceSmall 识别模型，供麦克风输入使用。',
      license: 'FunASR 模型许可；保留模型名称与来源声明',
      latestVersion: '1.0.0',
    },
  ],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const boundedText = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= max &&
  !Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
  });

export const parseResourceCatalog = (value: unknown): ResourceCatalog => {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['schemaVersion', 'resources']) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.resources) ||
    value.resources.length === 0 ||
    value.resources.length > RESOURCE_IDS.length
  ) {
    throw new Error('资源目录格式无效。');
  }
  const resources = value.resources.map((entry): ResourceCatalogEntry => {
    if (
      !isRecord(entry) ||
      !exactKeys(entry, ['id', 'name', 'summary', 'license', 'latestVersion']) ||
      !RESOURCE_IDS.includes(entry.id as ResourceCatalogId) ||
      !boundedText(entry.name, 80) ||
      !boundedText(entry.summary, 600) ||
      !boundedText(entry.license, 160) ||
      !(
        entry.latestVersion === null ||
        (typeof entry.latestVersion === 'string' &&
          entry.latestVersion.length <= 64 &&
          /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(entry.latestVersion))
      )
    ) {
      throw new Error('资源目录条目无效。');
    }
    return {
      id: entry.id as ResourceCatalogId,
      name: entry.name,
      summary: entry.summary,
      license: entry.license,
      latestVersion: entry.latestVersion,
    };
  });
  if (new Set(resources.map(({ id }) => id)).size !== resources.length) {
    throw new Error('资源目录包含重复条目。');
  }
  return { schemaVersion: 1, resources };
};

export const unavailableResourceCenter = (): ResourceCenterStatus => ({
  catalog: BUNDLED_RESOURCE_CATALOG,
  catalogSource: 'bundled',
  catalogMessage: '资源服务暂时不可用，文字聊天仍可使用。',
  downloads: { sourceConfigured: false, metered: false, busy: false, tiers: [] },
});
