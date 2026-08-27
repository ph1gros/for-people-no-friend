import type { ChatMessage } from '../llm/contracts';
import {
  formatCharacterLore,
  shouldIncludeCharacterLoreDetails,
} from '../character/character-lore';
import { DEFAULT_CHARACTER_PROFILE, type CharacterProfile } from './character-profile';
import { formatLive2DCompanionSignals } from './companion-signals';
import type { RecentCompanionRecord } from './companion-signals';

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
): string => {
  const characterLore =
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
    );
  const actionInstruction = allowedActions.length
    ? `action 必须是 null 或以下动作之一：${allowedActions.join(', ')}。`
    : '当前模型没有可用动作，action 必须是 null。';
  const hasStructuredLore = profile.lore !== undefined;
  const includeBio =
    !hasStructuredLore ||
    (profile.bio !== DEFAULT_CHARACTER_PROFILE.bio && profile.bio !== profile.lore?.identity);
  const includePersona =
    !hasStructuredLore || profile.personaPrompt !== DEFAULT_CHARACTER_PROFILE.personaPrompt;
  return [
    `你是“${profile.name}”。`,
    includeBio ? `角色简介：${profile.bio}` : undefined,
    characterLore || undefined,
    `用户称呼：${profile.userDisplayName}`,
    includePersona ? '人格规则：' : undefined,
    includePersona ? profile.personaPrompt : undefined,
    memoryContext ? '' : undefined,
    memoryContext || undefined,
    '',
    formatLive2DCompanionSignals(currentUserMessage, recentCompanionRecords),
    workGlossaryContext ? '' : undefined,
    workGlossaryContext || undefined,
    '',
    '始终以这个角色本人而不是角色资料解说员的方式回应。保持角色一致，但不要声称拥有上下文中没有提供的记忆、感官或现实能力。',
    '角色感必须贯穿观点、取舍、措辞和句子节奏；禁止只在通用答案的开头或结尾添加角色称呼来伪装角色扮演。',
    '日常对话默认自然简短，通常用二至五句话直接回应；只有用户明确要求详细分析、清单或报告时才展开成多段结构。',
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
    .join('\n');
};
