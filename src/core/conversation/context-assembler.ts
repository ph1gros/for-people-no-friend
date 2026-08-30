import type { ChatMessage } from '../llm/contracts';
import {
  formatCharacterLore,
  shouldIncludeCharacterLoreDetails,
} from '../character/character-lore';
import type { CharacterRoleplayExample } from '../character/character-lore';
import { DEFAULT_CHARACTER_PROFILE, type CharacterProfile } from './character-profile';
import { formatLive2DCompanionSignals } from './companion-signals';
import type { RecentCompanionRecord } from './companion-signals';
import { ConversationContextRegistry } from './context-registry';

const MAX_CONTEXT_MESSAGES = 20;
const MAX_CONTEXT_CHARACTERS = 24_000;

export const selectRecentMessages = (
  messages: readonly ChatMessage[],
  maximumMessages = MAX_CONTEXT_MESSAGES,
  maximumCharacters = MAX_CONTEXT_CHARACTERS,
): ChatMessage[] => {
  const selected: ChatMessage[] = [];
  let characters = 0;
  for (
    let index = messages.length - 1;
    index >= 0 && selected.length < maximumMessages;
    index -= 1
  ) {
    const message = messages[index];
    if (!message || !message.content.trim()) {
      continue;
    }
    if (selected.length > 0 && characters + message.content.length > maximumCharacters) {
      break;
    }
    selected.push({ role: message.role, content: message.content });
    characters += message.content.length;
  }
  return selected.reverse();
};

export const buildConversationSystemPrompt = (
  profile: CharacterProfile,
  allowedActions: readonly string[],
  memoryContext = '',
  currentUserMessage = '',
  workGlossaryContext = '',
  characterKnowledgeContext = '',
  recentCompanionRecords: readonly RecentCompanionRecord[] = [],
  selectedRoleplayExamples?: readonly CharacterRoleplayExample[],
): string => {
  const previousAssistantUsedStageDirection = (() => {
    for (let index = recentCompanionRecords.length - 1; index >= 0; index -= 1) {
      const record = recentCompanionRecords[index];
      if (record?.role !== 'assistant') continue;
      return /^(?:\s|\n)*(?:[（(][^）)\n]{1,60}[）)]|[*＊][^*＊\n]{1,60}[*＊])/u.test(
        record.content,
      );
    }
    return false;
  })();
  const baseCharacterLore =
    characterKnowledgeContext ||
    formatCharacterLore(
      profile.lore,
      profile.lore
        ? shouldIncludeCharacterLoreDetails(
            currentUserMessage,
            profile.lore.canonicalName,
            profile.lore.sourceWork,
          )
        : false,
      currentUserMessage,
      selectedRoleplayExamples ? [] : undefined,
    );
  const contextualExamples = selectedRoleplayExamples?.length
    ? [
        '当前情境命中的角色反应示例（结合最近上下文选择；学习行为与语气，不要逐字复读）：',
        ...selectedRoleplayExamples.map(
          (example) =>
            `- 场景：${example.scene}；情绪：${example.emotion}；触发：${example.trigger}；态度：${example.attitude}；示例：${example.line}`,
        ),
      ].join('\n')
    : '';
  const characterLore = [baseCharacterLore, contextualExamples].filter(Boolean).join('\n\n');
  const actionInstruction = allowedActions.length
    ? `action 必须是 null 或以下动作之一：${allowedActions.join(', ')}。`
    : '当前模型没有可用动作，action 必须是 null。';
  const hasStructuredLore = profile.lore !== undefined;
  const includeBio =
    !hasStructuredLore ||
    (profile.bio !== DEFAULT_CHARACTER_PROFILE.bio && profile.bio !== profile.lore?.identity);
  const includePersona =
    !hasStructuredLore || profile.personaPrompt !== DEFAULT_CHARACTER_PROFILE.personaPrompt;
  const registry = new ConversationContextRegistry();
  registry.replace({
    source: 'character-core',
    priority: 10,
    maximumCharacters: 16_000,
    content: [
      '【稳定角色核心】',
      `你是“${profile.name}”。`,
      includeBio ? `角色简介：${profile.bio}` : undefined,
      characterLore || undefined,
      `用户称呼：${profile.userDisplayName}`,
      includePersona ? '人格规则：' : undefined,
      includePersona ? profile.personaPrompt : undefined,
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n'),
  });
  registry.replace({
    source: 'current-scene',
    priority: 20,
    maximumCharacters: 12_000,
    content: [
      '【只属于当前会话的上下文】',
      formatLive2DCompanionSignals(currentUserMessage, recentCompanionRecords),
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n\n'),
  });
  registry.replace({
    source: 'long-term-memory',
    priority: 30,
    maximumCharacters: 12_000,
    content: memoryContext,
  });
  registry.replace({
    source: 'work-glossary',
    priority: 5,
    maximumCharacters: 12_000,
    content: workGlossaryContext,
  });
  registry.replace({
    source: 'reply-boundary',
    // Keep response and safety constraints even when other context fills the budget.
    // The registry restores source order after budget selection, so this priority
    // does not move the boundary ahead of the character and memory context.
    priority: 0,
    maximumCharacters: 12_000,
    content: [
      '【回复边界】',
      '给用户显示的 text 默认必须使用自然、清楚的简体中文；只有用户明确要求使用其他语言或引用原文时，才可在必要范围内保留对应语言。不要为了日语语音合成而把显示文字写成日语，语音层会单独转换。',
      '始终以这个角色本人而不是角色资料解说员的方式回应。保持角色一致，但不要声称拥有上下文中没有提供的记忆、感官或现实能力。',
      '只扮演当前角色，不替用户决定行动、补写心理活动或编造用户没有说过的话；一次只给出当前角色的一次回应。',
      '角色感必须贯穿观点、取舍、措辞和句子节奏；禁止只在通用答案的开头或结尾添加角色称呼来伪装角色扮演。',
      '日常对话默认自然简短，通常用二至五句话直接回应；只有用户明确要求详细分析、清单或报告时才展开成多段结构。',
      '默认只写角色实际说出口的话。不要习惯性使用“（动作）”“（表情）”“（声音变化）”或星号包裹的舞台旁白；emotion、action 和 Live2D 表现已经负责传达情绪。只有用户明确要求剧本/小说式描写，或当前强烈情绪确实需要强调时，整条回复最多使用一处简短动作描写，不能连续堆叠“手忙脚乱、脸红、声音越来越小”等模板。',
      previousAssistantUsedStageDirection
        ? '上一条角色回复已经使用了动作或神态旁白；本轮不要再使用括号或星号动作描写，直接自然说话。'
        : undefined,
      '即使讨论原作之外的话题，也要用该角色的认知方式和态度组织答案，但不要生硬套用原作名词或反复使用口头禅。',
      '涉及新闻、局势、价格等实时信息时，如果上下文没有提供可验证的最新资料，必须明确说明无法确认实时状态；不得把训练知识冒充为当前事实。',
      '遇到拼音缩写、社区黑话或近期新词时，先结合当前对话、角色语境和用户用法判断。存在多个合理含义或没有足够依据时，明确说明不确定并询问具体语境；不得为了维持角色口吻而编造词义或假装知道。',
      '普通对话不能静默联网查词。只有用户明确要求联网查询时，才能使用界面明确提供的单次查询能力；当前没有该能力时应直接说明并改为澄清。',
      '若当前上下文和作品社区词库都没有提供某个新词的可靠含义，应明确说不确定并询问用户所指语境；可以提示用户在设置中主动同步作品词库，获得用户确认前不得联网。',
      '不要习惯性地用“这样够用吗”“还需要什么吗”之类的客服式反问收尾；只有确实需要用户选择或澄清时才提问。',
      '只输出一个 JSON 对象，不要使用 Markdown 代码块，也不要在 JSON 前后添加文字。',
      'JSON 格式：{"text":"给用户看的自然回复","emotion":"neutral|happy|sad|angry|surprised|shy|playful","action":null}',
      'text 是完整回复；emotion 只选一个最贴近回复语气的值。',
      actionInstruction,
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n'),
  });
  return registry
    .snapshot(40_000)
    .map(({ content }) => content)
    .join('\n\n');
};
