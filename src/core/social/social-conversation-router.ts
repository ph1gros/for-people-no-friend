import {
  SOCIAL_MAX_TEXT_LENGTH,
  describeSocialTarget,
  type SocialAudioPayload,
  type SocialIdHasher,
  type SocialMessage,
  type SocialPlatform,
  type SocialTarget,
} from './social-contracts';
import type { SocialActor, SocialActorDirectory } from './social-identity';
import { sanitizeSocialText } from './social-message';
import {
  describeSocialMemoryAudience,
  inferDefaultSocialMemoryScope,
  resolveSocialChannelToken,
  resolveSocialMemoryNamespace,
  type SocialMemoryAudience,
  type SocialMemoryScope,
} from './social-memory-scope';
import { describeSocialError } from './social-redaction';
import {
  DEFAULT_SOCIAL_REPLY_POLICY,
  decideSocialReply,
  type SocialIgnoreReason,
  type SocialReplyPolicy,
} from './social-reply-policy';
import type { SocialAdapterRegistry } from './social-registry';
import {
  SocialTurnManager,
  waitForSocialTurn,
  type SocialTurnOptions,
} from './social-turn-manager';

export interface SocialConversationRequest {
  actor: SocialActor;
  target: SocialTarget;
  text?: string;
  /** Raw platform audio. Transcription is a later milestone, so a port may reject it today. */
  audio?: SocialAudioPayload;
  replyToMessageId?: string;
  memoryNamespace: string;
  memoryScope: SocialMemoryScope;
  memoryAudience: SocialMemoryAudience;
  signal: AbortSignal;
}

export interface SocialConversationReply {
  text: string;
  audio?: SocialAudioPayload;
}

/**
 * The single seam between Social Presence and the existing character, memory and LLM pipeline.
 * Adding a platform must never require touching the conversation core, and the conversation core
 * never sees a native platform event.
 */
export interface SocialConversationPort {
  respond(request: SocialConversationRequest): Promise<SocialConversationReply | undefined>;
}

export interface SocialRouterContext {
  /** Memory namespace of the active character, used as the root of every social scope. */
  characterNamespace: string;
  /** Account ID belonging to the character on each platform, used to break reply loops. */
  selfUserIds?: Partial<Record<SocialPlatform, string>>;
  policies?: Partial<Record<SocialPlatform, SocialReplyPolicy>>;
}

export type SocialRouterDiagnostic =
  | {
      event: 'turn-decision';
      platform: SocialPlatform;
      action: 'listen' | 'wait' | 'interrupt' | 'ignore';
      reason?: string;
    }
  | { event: 'message-duplicate'; platform: SocialPlatform }
  | { event: 'reply-ignored'; platform: SocialPlatform; reason: SocialIgnoreReason }
  | { event: 'conversation-failed'; platform: SocialPlatform; message: string }
  | { event: 'send-failed'; platform: SocialPlatform; message: string }
  | { event: 'overloaded'; platform: SocialPlatform };

export type SocialRouterDiagnosticSink = (diagnostic: SocialRouterDiagnostic) => void;

export interface SocialConversationRouterOptions {
  turnOptions?: SocialTurnOptions;
  registry: SocialAdapterRegistry;
  directory: SocialActorDirectory;
  port: SocialConversationPort;
  hashId: SocialIdHasher;
  getContext: () => SocialRouterContext;
  now?: () => number;
  /** Upper bound on conversations processed at the same time across every platform. */
  maxConcurrentConversations?: number;
  deduplicationWindowMs?: number;
  maxDeduplicationEntries?: number;
  diagnostics?: SocialRouterDiagnosticSink;
}

const DEFAULT_MAX_CONCURRENT_CONVERSATIONS = 4;
const DEFAULT_DEDUPLICATION_WINDOW_MS = 600_000;
const DEFAULT_MAX_DEDUPLICATION_ENTRIES = 2_000;

/**
 * Normalized message, then identity, then reply gate, then memory scope, then conversation core,
 * then platform reply. Every platform shares this path, so no adapter reimplements LLM logic,
 * memory logic or the safety defaults.
 */
export class SocialConversationRouter {
  private readonly turns: SocialTurnManager;
  private readonly turnJobs = new Map<
    string,
    Array<{
      message: SocialMessage;
      epoch: number;
      namespace: string;
      priority: number;
      queuedAt: number;
    }>
  >();
  private readonly activeTurns = new Map<string, AbortController>();
  private readonly seenMessages = new Map<string, number>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly inFlight = new Set<AbortController>();
  private detach?: () => void;
  private disposed = false;
  private pending = 0;
  /** Bumped by stop() so work queued before the stop is dropped instead of replying late. */
  private epoch = 0;

  public constructor(private readonly options: SocialConversationRouterOptions) {
    this.turns = new SocialTurnManager(options.turnOptions, options.now);
  }

  public start(): void {
    if (this.disposed) throw new Error('The social conversation router is disposed.');
    this.detach ??= this.options.registry.onMessage((message) => this.handle(message));
  }

  public stop(): void {
    this.detach?.();
    this.detach = undefined;
    this.epoch += 1;
    for (const controller of [...this.inFlight]) controller.abort();
    this.inFlight.clear();
    this.activeTurns.clear();
    this.turnJobs.clear();
    this.turns.clear();
  }

  public dispose(): void {
    this.stop();
    this.seenMessages.clear();
    this.queues.clear();
    this.disposed = true;
  }

  /** Also usable directly by an adapter that delivers messages outside the registry fan-out. */
  public handle(message: SocialMessage): void {
    if (this.disposed) return;
    const { platform } = message.target;
    if (this.isDuplicate(message)) {
      this.options.diagnostics?.({ event: 'message-duplicate', platform });
      return;
    }
    const context = this.options.getContext();
    const key = `${context.characterNamespace}\u0000${describeSocialTarget(message.target)}`;
    const actor = this.options.directory.resolve(message);
    const gate = decideSocialReply({
      message,
      actor,
      selfUserId: context.selfUserIds?.[platform],
      policy: context.policies?.[platform] ?? DEFAULT_SOCIAL_REPLY_POLICY,
    });
    if (gate.action === 'ignore' && gate.reason !== 'mention-required') {
      this.options.diagnostics?.({ event: 'reply-ignored', platform, reason: gate.reason });
      return;
    }
    if (
      this.pending >= 32 ||
      (this.inFlight.size >= this.maxConcurrent() && !this.queues.has(key))
    ) {
      this.options.diagnostics?.({ event: 'overloaded', platform });
      return;
    }
    const decision = this.turns.admit({
      key,
      actorId: actor.actorId,
      owner: actor.actorClass === 'owner',
      addressed: message.mentionsCharacter || message.repliesToCharacter === true,
      direct: message.target.channelKind === 'direct',
      busy: this.queues.has(key),
      eligible: gate.action === 'answer',
    });
    if (decision.action === 'ignore' || decision.action === 'listen') {
      this.options.diagnostics?.({
        event: 'turn-decision',
        platform,
        action: decision.action,
        reason: decision.reason,
      });
      return;
    }
    if (decision.action !== 'answer')
      this.options.diagnostics?.({ event: 'turn-decision', platform, action: decision.action });
    if (decision.action === 'interrupt') this.activeTurns.get(key)?.abort();
    this.enqueue(message, context.characterNamespace, key, decision.priority);
  }

  /** Resolves once every queued conversation has settled. Test and shutdown helper. */
  public async drain(): Promise<void> {
    while (this.queues.size > 0) {
      await Promise.all([...this.queues.values()]);
    }
  }

  private maxConcurrent(): number {
    const configured =
      this.options.maxConcurrentConversations ?? DEFAULT_MAX_CONCURRENT_CONVERSATIONS;
    return Math.max(1, Math.trunc(configured));
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private isDuplicate(message: SocialMessage): boolean {
    const key = `${message.target.platform}\u0000${message.messageId}`;
    const now = this.now();
    const windowMs = this.options.deduplicationWindowMs ?? DEFAULT_DEDUPLICATION_WINDOW_MS;
    const seenAt = this.seenMessages.get(key);
    if (seenAt !== undefined && now - seenAt <= windowMs) return true;

    for (const [seenKey, timestamp] of this.seenMessages) {
      if (now - timestamp > windowMs) this.seenMessages.delete(seenKey);
    }
    const maximum = this.options.maxDeduplicationEntries ?? DEFAULT_MAX_DEDUPLICATION_ENTRIES;
    while (this.seenMessages.size >= maximum) {
      const oldest = this.seenMessages.keys().next();
      if (oldest.done) break;
      this.seenMessages.delete(oldest.value);
    }
    this.seenMessages.set(key, now);
    return false;
  }

  /** Serializes per target so one conversation cannot interleave with itself. */
  private enqueue(message: SocialMessage, namespace: string, key: string, priority: number): void {
    this.pending += 1;
    const epoch = this.epoch;
    const jobs = this.turnJobs.get(key) ?? [];
    jobs.push({ message, epoch, namespace, priority, queuedAt: this.turns.now() });
    jobs.sort((a, b) => b.priority - a.priority);
    this.turnJobs.set(key, jobs);
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        if (epoch !== this.epoch) return;
        const job = this.turnJobs.get(key)?.shift();
        if (!job) return;
        if (
          this.options.getContext().characterNamespace !== job.namespace ||
          this.turns.now() - job.queuedAt > this.turns.maxWaitMs
        ) {
          this.options.diagnostics?.({
            event: 'turn-decision',
            platform: job.message.target.platform,
            action: 'ignore',
            reason: 'stale-turn',
          });
          return;
        }
        try {
          await this.process(job.message, job.epoch, key, job.queuedAt, job.priority >= 40);
        } finally {
          const controller = this.activeTurns.get(key);
          if (controller) {
            this.inFlight.delete(controller);
            this.activeTurns.delete(key);
          }
          if (epoch === this.epoch) this.turns.finish(key);
        }
      })
      .catch(() => undefined);
    this.queues.set(key, next);
    void next.then(() => {
      this.pending -= 1;
      if (this.queues.get(key) === next) {
        this.queues.delete(key);
        this.turnJobs.delete(key);
      }
    });
  }

  private async process(
    message: SocialMessage,
    epoch: number,
    key: string,
    queuedAt: number,
    interrupt: boolean,
  ): Promise<void> {
    if (this.disposed || epoch !== this.epoch) return;
    const { platform } = message.target;
    if (this.inFlight.size >= this.maxConcurrent()) {
      this.options.diagnostics?.({ event: 'overloaded', platform });
      return;
    }
    const context = this.options.getContext();
    let actor = this.options.directory.resolve(message);
    const selfUserId = context.selfUserIds?.[platform];
    const decision = decideSocialReply({
      message,
      actor,
      ...(selfUserId !== undefined ? { selfUserId } : {}),
      policy: context.policies?.[platform] ?? DEFAULT_SOCIAL_REPLY_POLICY,
    });
    if (decision.action === 'ignore') {
      this.options.diagnostics?.({ event: 'reply-ignored', platform, reason: decision.reason });
      return;
    }

    const channelToken = resolveSocialChannelToken(this.options.hashId, message.target);
    const controller = new AbortController();
    this.activeTurns.set(key, controller);
    this.inFlight.add(controller);
    const delay = interrupt ? 0 : this.turns.delay(key, message.target.channelKind === 'direct');
    if (this.turns.now() - queuedAt + delay > this.turns.maxWaitMs) return;
    if (delay > 0) await waitForSocialTurn(delay, controller.signal);
    if (
      controller.signal.aborted ||
      epoch !== this.epoch ||
      this.options.getContext().characterNamespace !== context.characterNamespace
    )
      return;
    // A policy/binding can change while this job is sleeping; derive memory access only now.
    actor = this.options.directory.resolve(message);
    const latestContext = this.options.getContext();
    const latestDecision = decideSocialReply({
      message,
      actor,
      selfUserId: latestContext.selfUserIds?.[platform],
      policy: latestContext.policies?.[platform] ?? DEFAULT_SOCIAL_REPLY_POLICY,
    });
    if (latestDecision.action === 'ignore') return;
    const memoryScope = inferDefaultSocialMemoryScope(actor, message.target);
    const request: SocialConversationRequest = {
      actor,
      target: message.target,
      ...(message.text !== undefined ? { text: message.text } : {}),
      ...(message.audio !== undefined ? { audio: message.audio } : {}),
      ...(message.replyToMessageId !== undefined
        ? { replyToMessageId: message.replyToMessageId }
        : {}),
      memoryScope,
      memoryNamespace: resolveSocialMemoryNamespace(context.characterNamespace, {
        scope: memoryScope,
        actorId: actor.actorId,
        platform,
        channelToken,
      }),
      memoryAudience: describeSocialMemoryAudience(actor, message.target, channelToken),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
    };

    this.inFlight.add(controller);
    let reply: SocialConversationReply | undefined;
    try {
      reply = await abortableSocialReply(this.options.port.respond(request), request.signal);
    } catch (error) {
      this.options.diagnostics?.({
        event: 'conversation-failed',
        platform,
        message: describeSocialError(error),
      });
      this.inFlight.delete(controller);
      return;
    }

    if (
      request.signal.aborted ||
      this.options.getContext().characterNamespace !== context.characterNamespace
    ) {
      this.inFlight.delete(controller);
      return;
    }
    const text = reply?.text ? sanitizeSocialText(reply.text) : '';
    if (!text) {
      this.inFlight.delete(controller);
      return;
    }

    const adapter = this.options.registry.get(platform);
    if (!adapter) {
      this.inFlight.delete(controller);
      return;
    }
    const sendContext = { replyToMessageId: message.messageId, signal: request.signal };
    const voice = reply?.audio;
    const sendAudio = adapter.sendAudio?.bind(adapter);
    try {
      // A trigger authorizes exactly one reply, and the adapter consumes that credential before
      // it sends. So an unsupported capability routes to text up front, but a FAILED voice send
      // never falls back to text: retrying would either be rejected or double-post.
      if (voice && sendAudio && adapter.capabilities.audioMessage) {
        await abortableSocialReply(sendAudio(message.target, voice, sendContext), request.signal);
      } else {
        await abortableSocialReply(
          adapter.sendText(message.target, text.slice(0, SOCIAL_MAX_TEXT_LENGTH), sendContext),
          request.signal,
        );
      }
    } catch (error) {
      this.options.diagnostics?.({
        event: 'send-failed',
        platform,
        message: describeSocialError(error),
      });
    } finally {
      this.inFlight.delete(controller);
    }
  }
}

/** An adapter/provider that ignores cancellation must not hold the channel queue indefinitely. */
function abortableSocialReply<T>(work: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const aborted = (): void => {
      signal.removeEventListener('abort', aborted);
      resolve(undefined);
    };
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    work.then(
      (value) => {
        signal.removeEventListener('abort', aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', aborted);
        reject(error);
      },
    );
  });
}
