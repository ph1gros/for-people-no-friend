import { CharacterReplyStreamDecoder } from '../../core/character/character-reply';
import {
  buildConversationSystemPrompt,
  selectRecentMessages,
} from '../../core/conversation/context-assembler';
import { formatWorkGlossaryContext } from '../../core/conversation/work-glossary';
import { ConfigurationError, toPublicLlmError } from '../../core/llm/errors';
import type {
  ConversationEvent,
  ConversationMessage,
  StartConversationInput,
  StartConversationResult,
} from '../../shared/conversation-ipc';
import type { ModelRuntime } from '../llm/model-runtime';
import type { WorkGlossaryService } from '../glossary/work-glossary-service';
import { formatMemoryContext, type MemoryService } from '../memory/memory-service';
import type { CharacterProfileStore } from '../storage/character-profile-store';
import type { ConversationStore } from '../storage/conversation-store';

type ConversationEventSink = (event: ConversationEvent) => void;

interface ActiveConversation {
  controller: AbortController;
}

const busyResult = (): StartConversationResult => ({
  ok: false,
  error: {
    code: 'configuration',
    message: 'Another reply is already being generated.',
    retryable: false,
  },
});

export class ConversationRuntime {
  private readonly active = new Map<string, ActiveConversation>();

  public constructor(
    private readonly models: ModelRuntime,
    private readonly profiles: CharacterProfileStore,
    private readonly history: ConversationStore,
    private readonly memories?: MemoryService,
    private readonly glossary?: WorkGlossaryService,
  ) {}

  public listHistory(): Promise<ConversationMessage[]> {
    return this.history.list(100);
  }

  public clearHistory(): Promise<void> {
    if (this.active.size > 0) {
      return Promise.reject(new Error('Conversation history cannot be cleared during a reply.'));
    }
    return this.history.clear();
  }

  public start(
    input: StartConversationInput,
    emit: ConversationEventSink,
  ): StartConversationResult {
    if (this.active.size > 0 || this.active.has(input.requestId)) {
      return busyResult();
    }
    const controller = new AbortController();
    this.active.set(input.requestId, { controller });
    void this.run(input, controller.signal, emit).finally(() =>
      this.active.delete(input.requestId),
    );
    return { ok: true };
  }

  public cancel(requestId: string): boolean {
    const active = this.active.get(requestId);
    if (!active) {
      return false;
    }
    active.controller.abort();
    return true;
  }

  public dispose(): void {
    for (const conversation of this.active.values()) {
      conversation.controller.abort();
    }
    this.active.clear();
  }

  private async run(
    input: StartConversationInput,
    signal: AbortSignal,
    emit: ConversationEventSink,
  ): Promise<void> {
    let selectionProviderId = 'disabled';
    const decoder = new CharacterReplyStreamDecoder();
    try {
      const [profile, existingHistory, configuration] = await Promise.all([
        this.profiles.get(),
        this.history.list(100),
        this.models.getConversationConfiguration(),
      ]);
      const selection = configuration.selection;
      if (!selection) {
        throw new ConfigurationError('Choose a conversation provider and model first.');
      }
      selectionProviderId = selection.providerId;

      const userMessage: ConversationMessage = {
        id: `${input.requestId}-user`,
        role: 'user',
        content: input.message,
        createdAt: Date.now(),
        status: 'complete',
      };
      await this.history.append(userMessage);
      emit({ requestId: input.requestId, type: 'started', userMessage });

      let memoryContext = '';
      if (this.memories) {
        try {
          this.memories.handleExplicitIntent(profile.memoryNamespace, userMessage);
          memoryContext = formatMemoryContext(
            this.memories.getConversationContext(profile.memoryNamespace, input.message),
          );
        } catch {
          memoryContext = '';
        }
      }
      const context = selectRecentMessages([
        ...existingHistory
          .filter((message) => message.status === 'complete')
          .map((message) => ({ role: message.role, content: message.content })),
        { role: 'user', content: input.message },
      ]);
      const workGlossaryContext = this.glossary
        ? formatWorkGlossaryContext(
            await this.glossary.findMatches(profile.lore?.sourceWork ?? '', input.message),
          )
        : '';
      let inputTokens = 0;
      let outputTokens = 0;
      for await (const event of this.models.streamConversation(
        {
          systemPrompt: buildConversationSystemPrompt(
            profile,
            input.availableActions,
            memoryContext,
            input.message,
            workGlossaryContext,
          ),
          messages: context,
          temperature: 0.8,
          maxOutputTokens: 1_024,
        },
        selection,
        signal,
      )) {
        if (event.type === 'text-delta') {
          const visible = decoder.push(event.text);
          if (visible) {
            emit({ requestId: input.requestId, type: 'text-delta', text: visible });
          }
        } else if (event.type === 'usage') {
          inputTokens = event.inputTokens;
          outputTokens = event.outputTokens;
        }
      }

      const { reply, remainingText } = decoder.finish(input.availableActions);
      if (remainingText) {
        emit({ requestId: input.requestId, type: 'text-delta', text: remainingText });
      }
      const assistantMessage: ConversationMessage = {
        id: `${input.requestId}-assistant`,
        role: 'assistant',
        content: reply.text,
        createdAt: Date.now(),
        status: 'complete',
        emotion: reply.emotion,
        ...(reply.action ? { action: reply.action } : {}),
        providerId: selection.providerId,
        modelId: selection.modelId,
        inputTokens,
        outputTokens,
      };
      await this.history.append(assistantMessage);
      emit({ requestId: input.requestId, type: 'completed', assistantMessage });
      this.memories?.scheduleMaintenance(profile.memoryNamespace, selection, [
        ...existingHistory,
        userMessage,
        assistantMessage,
      ]);
    } catch (error) {
      const publicError = toPublicLlmError(error, selectionProviderId);
      if (publicError.code === 'cancelled') {
        const partialText = decoder.visibleText.trim();
        let assistantMessage: ConversationMessage | undefined;
        if (partialText) {
          assistantMessage = {
            id: `${input.requestId}-assistant`,
            role: 'assistant',
            content: partialText,
            createdAt: Date.now(),
            status: 'cancelled',
            emotion: 'neutral',
            providerId: selectionProviderId,
          };
          await this.history.append(assistantMessage).catch(() => undefined);
        }
        emit({
          requestId: input.requestId,
          type: 'cancelled',
          ...(assistantMessage ? { assistantMessage } : {}),
        });
      } else {
        emit({ requestId: input.requestId, type: 'error', error: publicError });
      }
    }
  }
}
