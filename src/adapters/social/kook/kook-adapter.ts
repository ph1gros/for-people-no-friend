import {
  describeSocialTarget,
  type SocialAdapterCapabilities,
  type SocialConnectionState,
  type SocialMessageHandler,
  type SocialPlatformAdapter,
  type SocialSendContext,
  type SocialTarget,
  type SocialVoiceSession,
} from '../../../core/social/social-contracts';
import { parseSocialTarget, sanitizeSocialText } from '../../../core/social/social-message';
import { normalizeKookMessage, type KookQuote } from './kook-events';
import { createKookTransport, type KookTransport } from './kook-transport';

export interface KookAdapterOptions {
  getToken(): Promise<string>;
  onReady?(selfUserId: string): void;
  createTransport?: typeof createKookTransport;
  now?: () => number;
  /**
   * Advertise joining voice rooms. Off by default: entering a room is visible to everyone in it,
   * so it stays an explicit opt-in. Speaking in the room is a separate, later capability.
   */
  voiceChannelEnabled?: boolean;
}

const CACHE_LIMIT = 2_000;
const REPLY_WINDOW_MS = 120_000;
const DEDUP_WINDOW_MS = 600_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 12;

const replyKey = (target: SocialTarget, messageId: string): string =>
  `${describeSocialTarget(target)}\u0000${messageId}`;

/**
 * Text-only KOOK adapter. Mirrors the QQ authorization model: only a recently received, exact
 * message can authorize one reply, and the credential is consumed before the send is attempted.
 */
export class KookAdapter implements SocialPlatformAdapter {
  public readonly platform = 'kook' as const;
  public readonly capabilities: SocialAdapterCapabilities;

  private readonly handlers = new Set<SocialMessageHandler>();
  private readonly stateHandlers = new Set<(state: SocialConnectionState) => void>();
  private readonly received = new Map<string, number>();
  private readonly seen = new Map<string, number>();
  private readonly quotes = new Map<string, KookQuote & { at: number }>();
  private readonly rates = new Map<string, { count: number; until: number }>();
  private transport?: KookTransport;
  private controller?: AbortController;
  private connecting?: Promise<void>;
  private selfUserId = '';
  private state: SocialConnectionState = 'offline';

  public constructor(private readonly options: KookAdapterOptions) {
    this.capabilities = Object.freeze({
      text: true as const,
      audioMessage: false,
      voiceChannel: options.voiceChannelEnabled === true,
      streamingText: false,
    });
  }

  public onMessage(handler: SocialMessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  public onStateChange(handler: (state: SocialConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  public async connect(): Promise<void> {
    this.connecting ??= this.openConnection().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  public async disconnect(): Promise<void> {
    const transport = this.transport;
    this.controller?.abort();
    this.controller = undefined;
    this.transport = undefined;
    transport?.stop();
    this.selfUserId = '';
    this.received.clear();
    this.rates.clear();
    this.quotes.clear();
    this.setState('offline');
  }

  public async sendText(
    target: SocialTarget,
    text: string,
    context?: SocialSendContext,
  ): Promise<void> {
    const validated = parseSocialTarget(target);
    const transport = this.transport;
    const controller = this.controller;
    if (
      validated.platform !== 'kook' ||
      validated.channelKind === 'group' ||
      !context ||
      !transport ||
      !controller ||
      this.state !== 'online'
    ) {
      throw new Error('KOOK reply is unavailable.');
    }
    const key = replyKey(validated, context.replyToMessageId);
    const receivedAt = this.received.get(key);
    if (receivedAt === undefined || this.now() - receivedAt > REPLY_WINDOW_MS) {
      throw new Error('The KOOK reply window expired.');
    }
    const clean = sanitizeSocialText(text);
    if (!clean) throw new Error('The KOOK reply is empty.');
    const signal = AbortSignal.any([
      controller.signal,
      context.signal,
      AbortSignal.timeout(30_000),
    ]);
    signal.throwIfAborted();
    // Consume BEFORE sending: uncertain network outcomes must not cause duplicate side effects.
    this.received.delete(key);
    try {
      const sent = await transport.sendText(
        {
          kind: validated.channelKind === 'direct' ? 'direct' : 'channel',
          id: validated.channelId,
        },
        clean,
        signal,
      );
      signal.throwIfAborted();
      this.quotes.set(`${validated.channelId}\u0000${sent.id}`, {
        id: sent.id,
        text: clean,
        at: this.now(),
      });
      this.trim(this.quotes);
    } catch {
      throw new Error('KOOK could not send the reply.');
    }
  }

  /** Explicit room membership and WAV playback; never automatically broadcasts private replies. */
  public async joinVoice(target: SocialTarget): Promise<SocialVoiceSession> {
    const validated = parseSocialTarget(target);
    const transport = this.transport;
    const controller = this.controller;
    if (
      !this.capabilities.voiceChannel ||
      validated.platform !== 'kook' ||
      validated.channelKind !== 'channel' ||
      !transport ||
      !controller ||
      this.state !== 'online'
    ) {
      throw new Error('KOOK voice channel is unavailable.');
    }
    try {
      const handle = await transport.joinVoice(validated.channelId, controller.signal);
      return {
        target: validated,
        play: handle.play ? (wav, signal) => handle.play!(wav, signal) : undefined,
        leave: () => handle.leave(),
      };
    } catch {
      throw new Error('KOOK could not join the voice channel.');
    }
  }

  private async openConnection(): Promise<void> {
    if (this.transport) return;
    this.setState('connecting');
    const controller = new AbortController();
    this.controller = controller;
    try {
      const token = await this.options.getToken();
      const transport = (this.options.createTransport ?? createKookTransport)(token);
      this.transport = transport;
      await transport.start(controller.signal, {
        ready: (selfUserId) => {
          this.selfUserId = selfUserId;
          this.options.onReady?.(selfUserId);
        },
        message: (value) => this.receive(value),
        state: (state) => this.setState(state === 'connecting' ? 'connecting' : state),
      });
    } catch (error) {
      await this.disconnect();
      this.setState('error');
      throw error instanceof Error ? new Error('KOOK connection failed.') : error;
    }
  }

  private receive(value: unknown): void {
    const now = this.now();
    this.prune(now);
    if (!this.selfUserId) return;
    const message = normalizeKookMessage(value, {
      selfUserId: this.selfUserId,
      now,
      findQuote: (targetId, quotedId) => this.quotes.get(`${targetId}\u0000${quotedId}`),
    });
    if (!message) return;
    // The safety default lives in the core reply gate; the adapter only forwards what it may.
    if (
      message.target.channelKind !== 'direct' &&
      !message.mentionsCharacter &&
      !message.repliesToCharacter
    ) {
      return;
    }
    const dedupeKey = `${message.target.channelId}\u0000${message.messageId}`;
    if (this.seen.has(dedupeKey)) return;
    this.seen.set(dedupeKey, now);
    this.trim(this.seen);
    if (!this.admit(message.userId, now)) return;

    this.received.set(replyKey(message.target, message.messageId), now);
    this.trim(this.received);
    for (const handler of [...this.handlers]) {
      try {
        handler(message);
      } catch {
        // A failing consumer must not take down the gateway event loop.
      }
    }
  }

  /** Bounded per-sender admission so one account cannot monopolise the model. */
  private admit(userId: string, now: number): boolean {
    const entry = this.rates.get(userId);
    if (!entry || entry.until <= now) {
      this.rates.set(userId, { count: 1, until: now + RATE_WINDOW_MS });
      this.trim(this.rates);
      return true;
    }
    if (entry.count >= RATE_LIMIT) return false;
    entry.count += 1;
    return true;
  }

  private prune(now: number): void {
    for (const [key, at] of this.seen) if (now - at > DEDUP_WINDOW_MS) this.seen.delete(key);
    for (const [key, at] of this.received)
      if (now - at > REPLY_WINDOW_MS) this.received.delete(key);
    for (const [key, quote] of this.quotes) {
      if (now - quote.at > DEDUP_WINDOW_MS) this.quotes.delete(key);
    }
    for (const [key, entry] of this.rates) if (entry.until <= now) this.rates.delete(key);
  }

  private trim(cache: Map<string, unknown>): void {
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  }

  private setState(state: SocialConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const handler of [...this.stateHandlers]) {
      try {
        handler(state);
      } catch {
        // Presence listeners must never break the transport.
      }
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}
