import {
  describeSocialTarget,
  type SocialAdapterCapabilities,
  type SocialConnectionState,
  type SocialMessageHandler,
  type SocialPlatformAdapter,
  type SocialSendContext,
  type SocialTarget,
} from '../../../core/social/social-contracts';
import { parseSocialTarget, sanitizeSocialText } from '../../../core/social/social-message';
import { OneBotConnection, OneBotError, type OneBotConnectionOptions } from './onebot-connection';
import { normalizeOneBotMessage, oneBotId, type OneBotQuote } from './onebot-events';

export interface OneBotAdapterOptions {
  /** Loopback WebSocket endpoint of the bridge. Validated by the connection. */
  url: string;
  getAccessToken?(): Promise<string | undefined>;
  onReady?(selfId: string): void;
  createConnection?: (options: OneBotConnectionOptions) => OneBotConnection;
  now?: () => number;
}

const CACHE_LIMIT = 2_000;
const REPLY_WINDOW_MS = 120_000;
const DEDUP_WINDOW_MS = 600_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 12;

const replyKey = (target: SocialTarget, messageId: string): string =>
  `${describeSocialTarget(target)} ${messageId}`;

/**
 * Text-only adapter speaking OneBot v11 to a locally running bridge. Reported as the `oopz`
 * platform, which is what this bridge is for today; the protocol itself is platform-neutral, so
 * any other OneBot implementation would work the same way.
 *
 * Authorization mirrors QQ and KOOK: only a recently received, exact message can authorize one
 * reply, and the credential is consumed before the send is attempted.
 */
export class OneBotAdapter implements SocialPlatformAdapter {
  public readonly platform = 'oopz' as const;
  public readonly capabilities: SocialAdapterCapabilities = Object.freeze({
    text: true as const,
    audioMessage: false,
    voiceChannel: false,
    streamingText: false,
  });

  private readonly handlers = new Set<SocialMessageHandler>();
  private readonly stateHandlers = new Set<(state: SocialConnectionState) => void>();
  private readonly received = new Map<string, number>();
  private readonly seen = new Map<string, number>();
  private readonly quotes = new Map<string, OneBotQuote & { at: number }>();
  private readonly rates = new Map<string, { count: number; until: number }>();
  private connection?: OneBotConnection;
  private connecting?: Promise<void>;
  private selfId = '';
  private state: SocialConnectionState = 'offline';

  public constructor(private readonly options: OneBotAdapterOptions) {}

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
    const connection = this.connection;
    this.connection = undefined;
    connection?.stop();
    this.selfId = '';
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
    const connection = this.connection;
    if (
      validated.platform !== 'oopz' ||
      validated.channelKind === 'channel' ||
      !context ||
      !connection ||
      this.state !== 'online'
    ) {
      throw new Error('OneBot reply is unavailable.');
    }
    const key = replyKey(validated, context.replyToMessageId);
    const receivedAt = this.received.get(key);
    if (receivedAt === undefined || this.now() - receivedAt > REPLY_WINDOW_MS) {
      throw new Error('The OneBot reply window expired.');
    }
    const clean = sanitizeSocialText(text);
    if (!clean) throw new Error('The OneBot reply is empty.');
    context.signal.throwIfAborted();
    // Consume BEFORE sending: uncertain network outcomes must not cause duplicate side effects.
    this.received.delete(key);
    try {
      const direct = validated.channelKind === 'direct';
      const data = await connection.call(direct ? 'send_private_msg' : 'send_group_msg', {
        ...(direct ? { user_id: validated.channelId } : { group_id: validated.channelId }),
        // Plain text only: auto-escaping keeps model output from becoming CQ markup.
        message: [{ type: 'text', data: { text: clean } }],
      });
      context.signal.throwIfAborted();
      const sent =
        typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
      const id = oneBotId(sent.message_id);
      if (id) {
        this.quotes.set(`${validated.channelId} ${id}`, { id, text: clean, at: this.now() });
        this.trim(this.quotes);
      }
    } catch {
      throw new Error('OneBot could not send the reply.');
    }
  }

  private async openConnection(): Promise<void> {
    if (this.connection) return;
    this.setState('connecting');
    try {
      const accessToken = await this.options.getAccessToken?.();
      const connection = (
        this.options.createConnection ?? ((options) => new OneBotConnection(options))
      )({
        url: this.options.url,
        ...(accessToken ? { accessToken } : {}),
      });
      this.connection = connection;
      connection.start({
        ready: (selfId) => {
          this.selfId = selfId;
          this.options.onReady?.(selfId);
        },
        event: (value) => this.receive(value),
        state: (state) => this.setState(state),
      });
    } catch (error) {
      await this.disconnect();
      this.setState('error');
      throw error instanceof OneBotError ? new Error('OneBot connection failed.') : error;
    }
  }

  private receive(value: unknown): void {
    const now = this.now();
    this.prune(now);
    if (!this.selfId) return;
    const message = normalizeOneBotMessage(value, {
      selfId: this.selfId,
      now,
      findQuote: (targetId, quotedId) => this.quotes.get(`${targetId} ${quotedId}`),
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
    const dedupeKey = `${message.target.channelId} ${message.messageId}`;
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
        // A failing consumer must not take down the bridge event loop.
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
    for (const [key, at] of this.received) {
      if (now - at > REPLY_WINDOW_MS) this.received.delete(key);
    }
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
