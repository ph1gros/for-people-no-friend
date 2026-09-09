import {
  describeSocialTarget,
  type SocialAdapterCapabilities,
  type SocialAudioPayload,
  type SocialConnectionState,
  type SocialMessageHandler,
  type SocialPlatformAdapter,
  type SocialSendContext,
  type SocialTarget,
} from '../../../core/social/social-contracts';
import { parseSocialTarget, sanitizeSocialText } from '../../../core/social/social-message';
import { normalizeQqMessage, qqId, type QqQuote } from './qq-events';
import { createQqTransport, type QqTransport } from './qq-transport';

export interface QqAdapterOptions {
  appId: string;
  getCredentials(): Promise<{ appId: string; appSecret: string }>;
  onReady?(selfUserId: string): void;
  createTransport?: typeof createQqTransport;
  now?: () => number;
  /**
   * Advertise native voice replies. The caller enables this only after confirming the optional
   * SILK codec loaded, so an unavailable codec never turns into a failing send.
   */
  voiceEnabled?: boolean;
}

const replyKey = (target: SocialTarget, messageId: string): string =>
  `${describeSocialTarget(target)}\u0000${messageId}`;

const CACHE_LIMIT = 2_000;
const REPLY_WINDOW_MS = 120_000;
const DEDUP_WINDOW_MS = 600_000;

/** Text-only QQ adapter. Only a recently received, exact message can authorize a reply. */
export class QqAdapter implements SocialPlatformAdapter {
  public readonly platform = 'qq' as const;
  public readonly capabilities: SocialAdapterCapabilities;
  private readonly handlers = new Set<SocialMessageHandler>();
  private readonly stateHandlers = new Set<(state: SocialConnectionState) => void>();
  private readonly received = new Map<string, number>();
  private readonly seen = new Map<string, number>();
  private readonly quotes = new Map<string, QqQuote & { at: number }>();
  private readonly rates = new Map<string, { count: number; until: number }>();
  private transport?: QqTransport;
  private controller?: AbortController;
  private connecting?: Promise<void>;
  private selfUserId = '';
  private state: SocialConnectionState = 'offline';

  public constructor(private readonly options: QqAdapterOptions) {
    this.capabilities = Object.freeze({
      text: true as const,
      audioMessage: options.voiceEnabled === true,
      voiceChannel: false,
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

  public connect(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.state === 'online') return Promise.resolve();
    const controller = new AbortController();
    this.controller?.abort();
    this.transport?.stop();
    this.controller = controller;
    this.setState('connecting');
    const connection = this.open(controller).finally(() => {
      if (this.connecting === connection) this.connecting = undefined;
    });
    this.connecting = connection;
    return connection;
  }

  private async open(controller: AbortController): Promise<void> {
    let transport: QqTransport | undefined;
    try {
      const credentials = await this.options.getCredentials();
      controller.signal.throwIfAborted();
      if (credentials.appId !== this.options.appId) throw new Error('QQ configuration changed.');
      transport = await (this.options.createTransport ?? createQqTransport)(credentials);
      controller.signal.throwIfAborted();
      this.transport = transport;
      await transport.start(controller.signal, {
        ready: (selfUserId) => {
          if (controller.signal.aborted) return;
          if (!qqId(selfUserId)) {
            controller.abort();
            return;
          }
          this.selfUserId = selfUserId;
          this.options.onReady?.(selfUserId);
        },
        message: (value) => {
          if (!controller.signal.aborted && this.state === 'online') this.receive(value);
        },
        state: (state) => {
          if (!controller.signal.aborted) this.setState(state);
        },
      });
      controller.signal.throwIfAborted();
      if (!this.selfUserId) throw new Error('QQ did not identify the account.');
      this.setState('online');
    } catch {
      controller.abort();
      transport?.stop();
      if (this.controller === controller) this.setState('error');
      throw new Error('QQ connection failed. Check the bot configuration and try again.');
    }
  }

  public async disconnect(): Promise<void> {
    const controller = this.controller;
    this.controller = undefined;
    controller?.abort();
    this.transport?.stop();
    this.transport = undefined;
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
      validated.platform !== 'qq' ||
      validated.channelKind === 'channel' ||
      validated.serverId ||
      !context ||
      !transport ||
      !controller ||
      this.state !== 'online'
    ) {
      throw new Error('QQ reply is unavailable.');
    }
    const key = replyKey(validated, context.replyToMessageId);
    const receivedAt = this.received.get(key);
    if (receivedAt === undefined || this.now() - receivedAt > REPLY_WINDOW_MS) {
      throw new Error('The QQ reply window expired.');
    }
    const clean = sanitizeSocialText(text);
    if (!clean) throw new Error('The QQ reply is empty.');
    const signal = AbortSignal.any([
      controller.signal,
      context.signal,
      AbortSignal.timeout(30_000),
    ]);
    signal.throwIfAborted();
    // Consume BEFORE sending: uncertain network outcomes must not cause duplicate side effects.
    this.received.delete(key);
    try {
      const kind = validated.channelKind === 'direct' ? 'c2c' : 'group';
      const sent = await transport.sendText(
        { kind, id: validated.channelId, messageId: context.replyToMessageId },
        clean,
        signal,
      );
      signal.throwIfAborted();
      if (qqId(sent.id)) {
        const quote = { id: sent.id, text: clean, at: this.now() };
        this.quotes.set(`${kind}\u0000${validated.channelId}\u0000${sent.id}`, quote);
        if (qqId(sent.refIdx))
          this.quotes.set(`${kind}\u0000${validated.channelId}\u0000${sent.refIdx}`, quote);
        this.trim(this.quotes);
      }
    } catch {
      throw new Error('QQ could not send the reply.');
    }
  }

  /** Native voice reply. Authorized exactly like a text reply: one recent, exact trigger only. */
  public async sendAudio(
    target: SocialTarget,
    audio: SocialAudioPayload,
    context?: SocialSendContext,
  ): Promise<void> {
    const validated = parseSocialTarget(target);
    const transport = this.transport;
    const controller = this.controller;
    if (
      !this.capabilities.audioMessage ||
      validated.platform !== 'qq' ||
      validated.channelKind === 'channel' ||
      validated.serverId ||
      !context ||
      !transport ||
      !controller ||
      this.state !== 'online'
    ) {
      throw new Error('QQ voice reply is unavailable.');
    }
    if (
      !audio ||
      audio.mimeType !== 'audio/silk' ||
      !(audio.data instanceof Uint8Array) ||
      audio.data.byteLength === 0
    ) {
      throw new Error('The QQ voice reply is invalid.');
    }
    const key = replyKey(validated, context.replyToMessageId);
    const receivedAt = this.received.get(key);
    if (receivedAt === undefined || this.now() - receivedAt > REPLY_WINDOW_MS) {
      throw new Error('The QQ reply window expired.');
    }
    const signal = AbortSignal.any([
      controller.signal,
      context.signal,
      AbortSignal.timeout(30_000),
    ]);
    signal.throwIfAborted();
    // Consume BEFORE sending: an uncertain network outcome must not allow a second voice note.
    this.received.delete(key);
    try {
      await transport.sendVoice(
        {
          kind: validated.channelKind === 'direct' ? 'c2c' : 'group',
          id: validated.channelId,
          messageId: context.replyToMessageId,
        },
        audio.data,
        signal,
      );
    } catch {
      throw new Error('QQ could not send the voice reply.');
    }
  }

  private receive(value: unknown): void {
    const now = this.now();
    this.prune(now);
    const message = normalizeQqMessage(value, {
      appId: this.options.appId,
      selfUserId: this.selfUserId,
      now,
      findQuote: (kind, targetId, reference) =>
        this.quotes.get(`${kind}\u0000${targetId}\u0000${reference}`),
    });
    if (!message) return;
    if (
      message.target.channelKind === 'group' &&
      !message.mentionsCharacter &&
      !message.repliesToCharacter
    )
      return;
    const key = `${describeSocialTarget(message.target)}\u0000${message.messageId}`;
    if (this.seen.has(key)) return;
    this.seen.set(key, now);
    this.trim(this.seen);
    if (
      !this.allowRate(
        ['global', `user:${message.userId}`, `target:${describeSocialTarget(message.target)}`],
        now,
      )
    )
      return;
    this.received.set(key, now);
    this.trim(this.received);
    for (const handler of [...this.handlers]) {
      try {
        handler(message);
      } catch {
        /* An optional consumer cannot stop transport delivery. */
      }
    }
  }

  private allowRate(keys: string[], now: number): boolean {
    const limits = [60, 12, 30];
    if (keys.some((key, i) => (this.rates.get(key)?.count ?? 0) >= limits[i]!)) return false;
    for (const key of keys) {
      const current = this.rates.get(key) ?? { count: 0, until: now + 60_000 };
      current.count += 1;
      this.rates.set(key, current);
    }
    return true;
  }

  private prune(now: number): void {
    for (const [key, at] of this.seen) if (now - at > DEDUP_WINDOW_MS) this.seen.delete(key);
    for (const [key, at] of this.received)
      if (now - at > REPLY_WINDOW_MS) this.received.delete(key);
    for (const [key, quote] of this.quotes)
      if (now - quote.at > DEDUP_WINDOW_MS) this.quotes.delete(key);
    for (const [key, rate] of this.rates) if (now >= rate.until) this.rates.delete(key);
  }

  private trim<T>(map: Map<string, T>): void {
    while (map.size > CACHE_LIMIT) map.delete(map.keys().next().value!);
  }
  private now(): number {
    return (this.options.now ?? Date.now)();
  }
  private setState(state: SocialConnectionState): void {
    this.state = state;
    for (const handler of this.stateHandlers) {
      try {
        handler(state);
      } catch {
        /* Status observers are optional. */
      }
    }
  }
}
