import { randomUUID } from 'node:crypto';

import type { CharacterKnowledgeRecord } from '../../core/character/character-knowledge';
import {
  DEFAULT_CHARACTER_PROFILE,
  validateCharacterProfile,
  type CharacterProfile,
} from '../../core/conversation/character-profile';
import type {
  SocialConversationPort,
  SocialConversationReply,
  SocialConversationRequest,
} from '../../core/social/social-conversation-router';
import {
  SOCIAL_ID_TOKEN_PATTERN,
  SOCIAL_MAX_TEXT_LENGTH,
} from '../../core/social/social-contracts';
import {
  inferDefaultSocialMemoryScope,
  resolveSocialMemoryNamespace,
} from '../../core/social/social-memory-scope';
import { parseSocialTarget, sanitizeSocialText } from '../../core/social/social-message';
import { ConversationRuntime } from '../conversation/conversation-runtime';
import type { WorkGlossaryService } from '../glossary/work-glossary-service';
import type { ModelRuntime } from '../llm/model-runtime';
import type { MemoryService } from '../memory/memory-service';
import type { CharacterKnowledgeStore } from '../storage/character-knowledge-store';
import type { CharacterProfileStore } from '../storage/character-profile-store';
import type { ConversationStore } from '../storage/conversation-store';
import type { SocialVoiceSynthesizer } from './social-voice-reply';

export interface SocialConversationPortOptions {
  models: ModelRuntime;
  profiles: CharacterProfileStore;
  history: ConversationStore;
  memoryService?: MemoryService;
  glossary?: WorkGlossaryService;
  characterKnowledge?: CharacterKnowledgeStore;
  /** Snapshot of the account's explicitly bound character, taken when connecting. */
  profile: CharacterProfile;
  /** Covers queueing, context retrieval and generation. Default 60 seconds; at most 120 seconds. */
  timeoutMs?: number;
  /** Includes the running turn. Default 16; at most 64. One runtime per connected account. */
  maxPendingRequests?: number;
  /** Optional native voice replies. Absent, disabled or failing keeps the reply text-only. */
  voice?: SocialVoiceSynthesizer;
}

const boundedInteger = (value: number, maximum: number): number => {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error('The social conversation limits are invalid.');
  }
  return value;
};

/**
 * Legacy lore has no visibility labels. Owner-facing fields and unclassified relationships /
 * examples are withheld wholesale. Other character fields must not contain owner references.
 * This projection is used for both the profile fallback and stored knowledge retrieval.
 */
const publicCharacter = (
  profile: CharacterProfile,
): {
  profile: CharacterProfile;
  includeRecord: (record: CharacterKnowledgeRecord) => boolean;
} => {
  const ownerName = profile.userDisplayName.normalize('NFKC').trim().toLowerCase();
  const ownerReference =
    /用户|主人|拥有者|饲主|搭档|恋人|男友|女友|老公|老婆|私下|私密|秘密|你|您|\b(?:user|owner|partner|private|secret|you|your)\b/iu;
  const isPublic = (text: string): boolean => {
    const normalized = text.normalize('NFKC').toLowerCase();
    return !ownerReference.test(normalized) && !(ownerName && normalized.includes(ownerName));
  };
  const visible = (text: string): string => (isPublic(text) ? text : '');
  const lore = profile.lore;
  return {
    profile: {
      ...profile,
      userDisplayName: '当前发言者',
      bio: lore ? visible(lore.identity) : '',
      personaPrompt: DEFAULT_CHARACTER_PROFILE.personaPrompt,
      ...(lore
        ? {
            lore: {
              ...lore,
              aliases: lore.aliases.filter(isPublic),
              identity: visible(lore.identity),
              personality: visible(lore.personality),
              background: visible(lore.background),
              speechStyle: visible(lore.speechStyle),
              relationships: [],
              sampleLines: [],
              roleplayExamples: [],
              sources: lore.sources.filter((source) => isPublic(JSON.stringify(source))),
            },
          }
        : {}),
    },
    includeRecord: (record) =>
      ['identity', 'trait', 'event', 'speech-rule'].includes(record.kind) &&
      !record.evidence.some(({ fieldPath }) =>
        /relationships|roleplayExamples|sampleLines/u.test(fieldPath),
      ) &&
      isPublic(JSON.stringify(record)),
  };
};

export class RuntimeSocialConversationPort implements SocialConversationPort {
  public readonly characterId: string;
  public readonly characterNamespace: string;
  private readonly profile: CharacterProfile;
  private readonly publicCharacter: ReturnType<typeof publicCharacter>;
  private readonly runtime: ConversationRuntime;
  private readonly lifetime = new AbortController();
  private readonly timeoutMs: number;
  private readonly maximumPending: number;
  private readonly voice?: SocialVoiceSynthesizer;
  private pending = 0;
  private tail: Promise<void> = Promise.resolve();

  public constructor(options: SocialConversationPortOptions) {
    this.profile = structuredClone(validateCharacterProfile(options.profile));
    this.characterId = this.profile.id;
    this.characterNamespace = this.profile.memoryNamespace;
    this.publicCharacter = publicCharacter(this.profile);
    this.voice = options.voice;
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 60_000, 120_000);
    this.maximumPending = boundedInteger(options.maxPendingRequests ?? 16, 64);
    this.runtime = new ConversationRuntime(
      options.models,
      options.profiles,
      options.history,
      options.memoryService,
      options.glossary,
      options.characterKnowledge,
      // Social input never receives AssistantToolService or a speech/presentation sink.
    );
  }

  public respond(request: SocialConversationRequest): Promise<SocialConversationReply | undefined> {
    if (this.lifetime.signal.aborted || request.signal.aborted) return Promise.resolve(undefined);
    if (this.pending >= this.maximumPending) {
      return Promise.reject(new Error('The social conversation queue is full.'));
    }
    const target = parseSocialTarget(request.target);
    const audience = request.memoryAudience;
    const actor = { ...request.actor };
    const scope = inferDefaultSocialMemoryScope(actor, target);
    if (
      !new RegExp(`^${target.platform}-[a-f0-9]{8,64}$`).test(actor.actorId) ||
      !['owner', 'known-user', 'guest', 'unknown'].includes(actor.actorClass) ||
      actor.platform !== target.platform ||
      audience.actorId !== actor.actorId ||
      audience.actorClass !== actor.actorClass ||
      audience.platform !== target.platform ||
      audience.channelKind !== target.channelKind ||
      !SOCIAL_ID_TOKEN_PATTERN.test(audience.channelToken) ||
      request.memoryScope !== scope ||
      request.memoryNamespace !==
        resolveSocialMemoryNamespace(this.characterNamespace, {
          scope,
          actorId: actor.actorId,
          platform: target.platform,
          channelToken: audience.channelToken,
        })
    ) {
      throw new Error(
        'The social conversation scope does not match the bound character and audience.',
      );
    }
    if (
      request.audio ||
      typeof request.text !== 'string' ||
      request.text.length > SOCIAL_MAX_TEXT_LENGTH
    ) {
      return Promise.resolve(undefined);
    }
    const text = sanitizeSocialText(request.text);
    if (!text) return Promise.resolve(undefined);
    const ownerDirect = scope === 'private';
    const namespace = request.memoryNamespace;
    const message = ownerDirect
      ? text
      : `[发言者：${actor.actorId}；场景：${target.channelKind}]\n${text}`;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const signal = AbortSignal.any([request.signal, this.lifetime.signal, timeout.signal]);
    this.pending += 1;
    return new Promise((resolve, reject) => {
      const abort = (): void => resolve(undefined);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      const operation = this.tail.then(async () => {
        if (signal.aborted) return undefined;
        let reply: SocialConversationReply | undefined;
        let failed = false;
        await this.runtime.runScoped(
          {
            requestId: `social_${randomUUID()}`,
            message,
            availableActions: [],
            assistantMode: false,
          },
          {
            profile: this.profile,
            memoryNamespace: namespace,
            signal,
            allowExplicitMemory: ownerDirect,
            ...(!ownerDirect
              ? {
                  promptProfile: this.publicCharacter.profile,
                  includeKnowledgeRecord: this.publicCharacter.includeRecord,
                }
              : {}),
          },
          (event) => {
            if (event.type === 'completed') reply = { text: event.assistantMessage.content };
            if (event.type === 'error') failed = true;
          },
        );
        if (signal.aborted) return undefined;
        if (failed) throw new Error('The social conversation could not be completed.');
        if (!reply?.text || !this.voice) return reply;
        // Voice is additive: the text reply is already final, so a failed clip changes nothing.
        const audio = await this.voice.synthesize(reply.text, signal);
        return audio ? { ...reply, audio } : reply;
      });
      this.tail = operation
        .then(
          (reply) => {
            resolve(reply);
          },
          () => {
            reject(new Error('The social conversation could not be completed.'));
          },
        )
        .finally(() => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          this.pending -= 1;
        });
    });
  }

  public dispose(): void {
    this.lifetime.abort();
    this.runtime.dispose();
  }

  public drain(): Promise<void> {
    return this.tail;
  }
}

export const createSocialConversationPort = (
  options: SocialConversationPortOptions,
): RuntimeSocialConversationPort => new RuntimeSocialConversationPort(options);
