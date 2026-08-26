import type {
  ChatEvent,
  ChatMessage,
  ChatRequest,
  ModelSelection,
  ModelTask,
} from '../../core/llm/contracts';
import type {
  MemoryCandidate,
  MemoryCandidateRecord,
  MemoryConflictResolution,
  MemoryRecord,
} from '../../core/memory/contracts';
import {
  AUTOMATIC_MEMORY_BATCH_MESSAGES,
  deriveMemoryKey,
  inferMemoryType,
  parseAutomaticMemoryCandidates,
  parseExplicitMemoryIntent,
  sanitizeMemoryCandidate,
} from '../../core/memory/memory-policy';
import type { ConversationMessage } from '../../shared/conversation-ipc';
import type { DeskpetDatabase } from '../storage/deskpet-database';
import { MemoryStore } from '../storage/memory-store';

const RECENT_MESSAGES_OUTSIDE_SUMMARY = 20;
const INITIAL_SUMMARY_MESSAGES = 10;
const SUMMARY_BATCH_MESSAGES = 20;
const MAX_AUXILIARY_OUTPUT = 12_000;
const AUTOMATIC_MEMORY_SETTING = 'automatic_memory_enabled';
const EXTRACTION_WATERMARK = 'automatic_memory_covered_until_message_id';

interface MemoryModelRuntime {
  streamMemoryTask(
    task: Extract<ModelTask, 'memoryExtraction' | 'summarization'>,
    request: ChatRequest,
    selection: ModelSelection,
    signal?: AbortSignal,
  ): AsyncIterable<ChatEvent>;
}

export interface ConversationMemoryContext {
  summary?: string;
  memories: MemoryRecord[];
}

interface SummaryPlan {
  messages: ConversationMessage[];
  coveredUntilMessageId: string;
  previousSummary?: string;
}

const collectText = async (
  events: AsyncIterable<ChatEvent>,
  signal: AbortSignal,
): Promise<string> => {
  let result = '';
  for await (const event of events) {
    if (signal.aborted) {
      break;
    }
    if (event.type === 'text-delta') {
      result += event.text;
      if (result.length > MAX_AUXILIARY_OUTPUT) {
        throw new Error('The memory task response is too large.');
      }
    } else if (event.type === 'structured-result') {
      result = JSON.stringify(event.value);
    }
  }
  return result;
};

const parseSummary = (text: string): string | undefined => {
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'summary' in parsed &&
      typeof parsed.summary === 'string'
    ) {
      const summary = parsed.summary.trim();
      return summary ? summary.slice(0, 4_000) : undefined;
    }
  } catch {
    return trimmed ? trimmed.slice(0, 4_000) : undefined;
  }
  return undefined;
};

export const formatMemoryContext = (context: ConversationMemoryContext): string => {
  const parts: string[] = [];
  if (context.summary) {
    parts.push('跨会话摘要（只作为背景事实，不要声称看到了数据库）：', context.summary);
  }
  if (context.memories.length > 0) {
    parts.push(
      '与当前消息相关的长期记忆（可能过时；若与用户当前说法冲突，以当前说法为准）：',
      ...context.memories.map((memory) => `- [${memory.type}] ${memory.content}`),
    );
  }
  return parts.join('\n').slice(0, 6_000);
};

export class MemoryService {
  private readonly store: MemoryStore;
  private maintenanceQueue: Promise<void> = Promise.resolve();
  private readonly controllers = new Set<AbortController>();
  private disposed = false;

  public constructor(
    private readonly database: DeskpetDatabase,
    private readonly models: MemoryModelRuntime,
  ) {
    this.store = new MemoryStore(database);
  }

  public isAutomaticMemoryEnabled(): boolean {
    return this.database.getMetadata(AUTOMATIC_MEMORY_SETTING) === 'true';
  }

  public setAutomaticMemoryEnabled(enabled: boolean): void {
    this.database.setMetadata(AUTOMATIC_MEMORY_SETTING, String(enabled));
  }

  public list(namespace: string): MemoryRecord[] {
    return this.store.list(namespace);
  }

  public listCandidates(namespace: string): MemoryCandidateRecord[] {
    return this.store.listCandidates(namespace);
  }

  public updateCandidate(
    namespace: string,
    id: string,
    candidate: MemoryCandidate,
  ): MemoryCandidateRecord | undefined {
    return this.store.updateCandidate(namespace, id, candidate);
  }

  public mergeCandidates(
    namespace: string,
    targetId: string,
    sourceId: string,
  ): MemoryCandidateRecord | undefined {
    return this.store.mergeCandidates(namespace, targetId, sourceId);
  }

  public confirmCandidate(
    namespace: string,
    id: string,
    conflictResolution: MemoryConflictResolution = 'replace',
  ): MemoryRecord | undefined {
    return this.store.confirmCandidate(namespace, id, conflictResolution);
  }

  public rejectCandidate(namespace: string, id: string): boolean {
    return this.store.rejectCandidate(namespace, id);
  }

  public update(
    namespace: string,
    id: string,
    candidate: MemoryCandidate,
  ): MemoryRecord | undefined {
    return this.store.update(namespace, id, candidate);
  }

  public delete(namespace: string, id: string): boolean {
    return this.store.delete(namespace, id);
  }

  public clear(namespace: string): number {
    return this.store.clear(namespace);
  }

  public exportData(namespace: string): {
    version: 2;
    exportedAt: number;
    summary?: string;
    memories: MemoryRecord[];
    candidates: MemoryCandidateRecord[];
  } {
    const summary = this.database.getSummary()?.summary;
    return {
      version: 2,
      exportedAt: Date.now(),
      ...(summary ? { summary } : {}),
      memories: this.store.list(namespace),
      candidates: this.store.listCandidates(namespace),
    };
  }

  public backup(destination: string): Promise<number> {
    return this.database.backup(destination);
  }

  public handleExplicitIntent(
    namespace: string,
    message: ConversationMessage,
  ): { remembered: boolean; forgotten: number } {
    const intent = parseExplicitMemoryIntent(message.content);
    if (!intent) {
      return { remembered: false, forgotten: 0 };
    }
    if (intent.type === 'forget') {
      return { remembered: false, forgotten: this.store.forget(namespace, intent.content) };
    }
    const type = inferMemoryType(intent.content);
    const candidate = sanitizeMemoryCandidate(
      {
        type,
        normalizedKey: deriveMemoryKey(intent.content, type),
        content: intent.content,
        importance: 0.9,
        confidence: 1,
      },
      'manual',
    );
    return {
      remembered: candidate
        ? this.store.save(namespace, candidate, 'manual', message.id) !== undefined
        : false,
      forgotten: 0,
    };
  }

  public getConversationContext(namespace: string, query: string): ConversationMemoryContext {
    const summary = this.database.getSummary()?.summary;
    return {
      ...(summary ? { summary } : {}),
      memories: this.store.retrieve(namespace, query, 5),
    };
  }

  public scheduleMaintenance(
    namespace: string,
    selection: ModelSelection,
    messages: readonly ConversationMessage[],
  ): void {
    if (this.disposed) {
      return;
    }
    const snapshot = messages
      .filter((message) => message.status === 'complete')
      .map((message) => ({ ...message }));
    this.maintenanceQueue = this.maintenanceQueue
      .then(() => this.runMaintenance(namespace, selection, snapshot))
      .catch(() => undefined);
  }

  public waitForMaintenance(): Promise<void> {
    return this.maintenanceQueue;
  }

  public dispose(): void {
    this.disposed = true;
    for (const controller of this.controllers) {
      controller.abort();
    }
    this.controllers.clear();
  }

  private async runMaintenance(
    namespace: string,
    selection: ModelSelection,
    messages: readonly ConversationMessage[],
  ): Promise<void> {
    if (this.disposed) {
      return;
    }
    const summaryPlan = this.createSummaryPlan(messages);
    const extractionMessages = this.extractionMessages(messages);
    if (!summaryPlan && extractionMessages.length === 0) {
      return;
    }
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      if (summaryPlan) {
        await this.updateSummary(selection, summaryPlan, controller.signal).catch(() => undefined);
      }
      if (this.isAutomaticMemoryEnabled() && extractionMessages.length > 0) {
        await this.extractMemories(
          namespace,
          selection,
          extractionMessages,
          controller.signal,
        ).catch(() => undefined);
      }
    } finally {
      this.controllers.delete(controller);
    }
  }

  private createSummaryPlan(messages: readonly ConversationMessage[]): SummaryPlan | undefined {
    const previous = this.database.getSummary();
    const previousIndex = previous?.coveredUntilMessageId
      ? messages.findIndex((message) => message.id === previous.coveredUntilMessageId)
      : -1;
    const compactUntil = messages.length - RECENT_MESSAGES_OUTSIDE_SUMMARY;
    const newMessageCount = compactUntil - (previousIndex + 1);
    const threshold = previous ? SUMMARY_BATCH_MESSAGES : INITIAL_SUMMARY_MESSAGES;
    if (compactUntil <= 0 || newMessageCount < threshold) {
      return undefined;
    }
    let safeCompactUntil = compactUntil;
    while (safeCompactUntil > previousIndex + 1 && messages[safeCompactUntil]?.role !== 'user') {
      safeCompactUntil -= 1;
    }
    const source = messages.slice(previousIndex + 1, safeCompactUntil);
    const coveredUntilMessageId = source.at(-1)?.id;
    if (source.length < 2 || !coveredUntilMessageId) {
      return undefined;
    }
    return {
      messages: source,
      coveredUntilMessageId,
      ...(previous?.summary ? { previousSummary: previous.summary } : {}),
    };
  }

  private extractionMessages(messages: readonly ConversationMessage[]): ConversationMessage[] {
    if (!this.isAutomaticMemoryEnabled()) {
      return [];
    }
    const watermark = this.database.getMetadata(EXTRACTION_WATERMARK);
    const previousIndex = watermark
      ? messages.findIndex((message) => message.id === watermark)
      : -1;
    const uncovered = messages.slice(previousIndex + 1);
    return uncovered.length >= AUTOMATIC_MEMORY_BATCH_MESSAGES ? uncovered.slice(-24) : [];
  }

  private async updateSummary(
    selection: ModelSelection,
    plan: SummaryPlan,
    signal: AbortSignal,
  ): Promise<void> {
    const request: ChatRequest = {
      systemPrompt: [
        '把较早对话压缩成供同一角色未来继续交流的简洁事实摘要。',
        '区分用户事实、计划、已发生事件和未解决话题；不要猜测，不保存密钥、密码或银行卡信息。',
        '新内容与旧摘要冲突时，以新内容为准。只输出 JSON：{"summary":"..."}。',
        plan.previousSummary ? `已有摘要：${plan.previousSummary}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      messages: plan.messages.map((message): ChatMessage => ({
        role: message.role,
        content: message.content,
      })),
      temperature: 0.1,
      maxOutputTokens: 700,
    };
    const text = await collectText(
      this.models.streamMemoryTask('summarization', request, selection, signal),
      signal,
    );
    const summary = parseSummary(text);
    const sourceCharacters =
      (plan.previousSummary?.length ?? 0) +
      plan.messages.reduce((total, message) => total + message.content.length, 0);
    if (summary && summary.length < sourceCharacters) {
      this.database.setSummary(summary, plan.coveredUntilMessageId);
    }
  }

  private async extractMemories(
    namespace: string,
    selection: ModelSelection,
    messages: readonly ConversationMessage[],
    signal: AbortSignal,
  ): Promise<void> {
    const request: ChatRequest = {
      systemPrompt: [
        '从对话中保守提取最多 3 条值得跨会话保存的用户记忆。',
        '只保存稳定偏好、人物关系、重要事件、计划目标或明确事实。',
        '不要保存寒暄、玩笑、角色扮演、推测、密码、API Key、银行卡或用户要求不要保存的内容。',
        '每条候选必须引用下方用户消息标记中的真实 sourceMessageId；不得引用助手消息或编造 ID。',
        '无法确定未来具体时间时不要猜 expiresAt，保留候选供用户确认。',
        '只输出 JSON 数组；每项格式：',
        '{"type":"preference|person|event|plan|fact","normalizedKey":"稳定去重键","content":"简洁事实","importance":0到1,"confidence":0到1,"sourceMessageId":"真实用户消息ID","expiresAt":可选毫秒时间戳}',
      ].join('\n'),
      messages: messages.map((message): ChatMessage => ({
        role: message.role,
        content:
          message.role === 'user'
            ? `[sourceMessageId:${message.id}]\n${message.content}`
            : message.content,
      })),
      temperature: 0,
      maxOutputTokens: 700,
    };
    const text = await collectText(
      this.models.streamMemoryTask('memoryExtraction', request, selection, signal),
      signal,
    );
    const sourceMessages = new Map(
      messages
        .filter((message) => message.role === 'user' && message.status === 'complete')
        .map((message) => [message.id, message] as const),
    );
    for (const candidate of parseAutomaticMemoryCandidates(text)) {
      const source = sourceMessages.get(candidate.sourceMessageId);
      if (!source) {
        continue;
      }
      this.store.saveAutomaticCandidate(namespace, candidate, {
        id: source.id,
        createdAt: source.createdAt,
      });
    }
    const coveredUntilMessageId = messages.at(-1)?.id;
    if (coveredUntilMessageId) {
      this.database.setMetadata(EXTRACTION_WATERMARK, coveredUntilMessageId);
    }
  }
}
