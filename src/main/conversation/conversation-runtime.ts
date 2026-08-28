import { CharacterReplyStreamDecoder } from '../../core/character/character-reply';
import { GraphemeStreamBuffer } from '../../core/conversation/grapheme-stream';
import {
  adaptLegacyCharacterLore,
  createCharacterLoreRevision,
  formatCharacterKnowledgeContext,
  retrieveCharacterKnowledgeForPrompt,
  type CharacterKnowledgeBase,
} from '../../core/character/character-knowledge';
import type { CharacterProfile } from '../../core/conversation/character-profile';
import { validateCharacterProfile } from '../../core/conversation/character-profile';
import { resolveCompanionReplyEmotion } from '../../core/conversation/companion-signals';
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
import { resolveCharacterMemoryNamespace } from '../character/character-namespace';
import type { ModelRuntime } from '../llm/model-runtime';
import type { WorkGlossaryService } from '../glossary/work-glossary-service';
import {
  formatExplicitMemoryResult,
  formatMemoryContext,
  type MemoryService,
} from '../memory/memory-service';
import type { CharacterProfileStore } from '../storage/character-profile-store';
import type { CharacterKnowledgeStore } from '../storage/character-knowledge-store';
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
    private readonly characterKnowledge?: CharacterKnowledgeStore,
  ) {}

  public async listHistory(): Promise<ConversationMessage[]> {
    const profile = await this.profiles.get();
    return this.history.list(100, profile.memoryNamespace);
  }

  public async clearHistory(): Promise<void> {
    if (this.active.size > 0) {
      throw new Error('Conversation history cannot be cleared during a reply.');
    }
    const profile = await this.profiles.get();
    return this.history.clear(profile.memoryNamespace);
  }

  public async setCharacterProfile(profile: CharacterProfile): Promise<void> {
    if (this.active.size > 0) {
      throw new Error('Character cannot be updated during a reply.');
    }
    const input = validateCharacterProfile(profile);
    const validated = validateCharacterProfile({
      ...input,
      memoryNamespace: resolveCharacterMemoryNamespace(input),
    });
    const current = await this.profiles.get();
    const previousRevision = current.lore ? createCharacterLoreRevision(current.lore) : undefined;
    const nextRevision = validated.lore ? createCharacterLoreRevision(validated.lore) : undefined;
    await this.profiles.set(validated);
    if (!this.characterKnowledge || previousRevision === nextRevision) return;
    try {
      if (validated.lore) {
        this.characterKnowledge.replace(
          adaptLegacyCharacterLore(validated.memoryNamespace, validated.lore),
        );
      } else {
        this.characterKnowledge.clear(validated.memoryNamespace);
      }
    } catch {
      // The prompt path checks the revision and safely falls back to the validated profile.
    }
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
    const graphemes = new GraphemeStreamBuffer();
    try {
      const [profile, existingHistory, configuration] = await Promise.all([
        this.profiles.get(),
        this.profiles
          .get()
          .then((activeProfile) => this.history.list(100, activeProfile.memoryNamespace)),
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
      await this.history.append(userMessage, profile.memoryNamespace);
      emit({ requestId: input.requestId, type: 'started', userMessage });

      let memoryContext = '';
      if (this.memories) {
        try {
          const explicitResult = this.memories.handleExplicitIntent(
            profile.memoryNamespace,
            userMessage,
          );
          memoryContext = [
            formatExplicitMemoryResult(explicitResult),
            formatMemoryContext(
              this.memories.getConversationContext(profile.memoryNamespace, input.message),
            ),
          ]
            .filter(Boolean)
            .join('\n\n');
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
      const recentCompanionRecords = [...existingHistory, userMessage]
        .filter((message) => message.status === 'complete')
        .slice(-4)
        .map(({ role, content }) => ({ role, content }));
      const [workGlossaryContext, characterKnowledgeContext] = await Promise.all([
        this.glossary
          ? this.glossary
              .findMatches(
                profile.lore?.sourceWork ?? '',
                input.message,
                existingHistory
                  .filter((message) => message.status === 'complete')
                  .slice(-4)
                  .map((message) => message.content),
              )
              .then(formatWorkGlossaryContext)
              .catch(() => '')
          : '',
        this.buildCharacterKnowledgeContext(profile, input.message),
      ]);
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
            characterKnowledgeContext,
            recentCompanionRecords,
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
            const completeGraphemes = graphemes.push(visible);
            if (completeGraphemes) {
              emit({ requestId: input.requestId, type: 'text-delta', text: completeGraphemes });
            }
          }
        } else if (event.type === 'usage') {
          inputTokens = event.inputTokens;
          outputTokens = event.outputTokens;
        }
      }

      const { reply, remainingText } = decoder.finish(input.availableActions);
      const resolvedEmotion = resolveCompanionReplyEmotion(reply.emotion, recentCompanionRecords);
      const finalText = `${remainingText ? graphemes.push(remainingText) : ''}${graphemes.finish()}`;
      if (finalText) {
        emit({ requestId: input.requestId, type: 'text-delta', text: finalText });
      }
      const assistantMessage: ConversationMessage = {
        id: `${input.requestId}-assistant`,
        role: 'assistant',
        content: reply.text,
        createdAt: Date.now(),
        status: 'complete',
        emotion: resolvedEmotion,
        ...(reply.action ? { action: reply.action } : {}),
        providerId: selection.providerId,
        modelId: selection.modelId,
        inputTokens,
        outputTokens,
      };
      await this.history.append(assistantMessage, profile.memoryNamespace);
      emit({ requestId: input.requestId, type: 'completed', assistantMessage });
      this.memories?.scheduleMaintenance(profile.memoryNamespace, selection, [
        ...existingHistory,
        userMessage,
        assistantMessage,
      ]);
    } catch (error) {
      const trailingText = graphemes.finish();
      if (trailingText) {
        emit({ requestId: input.requestId, type: 'text-delta', text: trailingText });
      }
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
          const profile = await this.profiles.get();
          await this.history
            .append(assistantMessage, profile.memoryNamespace)
            .catch(() => undefined);
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

  private async buildCharacterKnowledgeContext(
    profile: CharacterProfile,
    query: string,
  ): Promise<string> {
    let base: CharacterKnowledgeBase | undefined;
    if (this.characterKnowledge) {
      try {
        const stored = this.characterKnowledge.get(profile.memoryNamespace);
        if (
          profile.lore &&
          stored?.characterNamespace === profile.memoryNamespace &&
          stored.profileRevision === createCharacterLoreRevision(profile.lore)
        ) {
          base = stored;
        }
      } catch {
        base = undefined;
      }
    }
    if (!base && profile.lore) {
      try {
        base = adaptLegacyCharacterLore(profile.memoryNamespace, profile.lore);
      } catch {
        return '';
      }
    }
    if (!base) return '';
    try {
      return formatCharacterKnowledgeContext(
        await retrieveCharacterKnowledgeForPrompt(
          { characterNamespace: profile.memoryNamespace, query },
          base.records,
        ),
      );
    } catch {
      return '';
    }
  }
}
