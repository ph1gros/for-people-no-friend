export interface SocialTurnOptions {
  channelCooldownMs?: number;
  directCooldownMs?: number;
  rateWindowMs?: number;
  maxActorTurns?: number;
  maxChannelTurns?: number;
  maxChannels?: number;
  maxActorsPerChannel?: number;
  maxWaitMs?: number;
  ownerPriority?: boolean;
  ownerInterrupt?: boolean;
}
export type SocialTurnDecision =
  | { action: 'listen'; reason: 'unaddressed' }
  | { action: 'ignore'; reason: 'actor-rate-limit' | 'channel-rate-limit' | 'context-capacity' }
  | { action: 'answer' | 'wait' | 'interrupt'; priority: number };
interface ChannelContext {
  hits: number[];
  actors: Map<string, number[]>;
  finishedAt?: number;
  lastObservedAt: number;
  observed: number;
}

/** Bounded metadata only: never stores message bodies, audio, private history or display names. */
export class SocialTurnManager {
  private readonly channels = new Map<string, ChannelContext>();
  private clock = 0;
  private readonly settings: Required<SocialTurnOptions>;
  public constructor(
    options: SocialTurnOptions = {},
    private readonly readClock = Date.now,
  ) {
    this.settings = {
      channelCooldownMs: 1000,
      directCooldownMs: 0,
      rateWindowMs: 10000,
      maxActorTurns: 4,
      maxChannelTurns: 12,
      maxChannels: 256,
      maxActorsPerChannel: 64,
      maxWaitMs: 15000,
      ownerPriority: false,
      ownerInterrupt: false,
      ...options,
    };
    for (const [key, value] of Object.entries(this.settings)) {
      if (key === 'ownerPriority' || key === 'ownerInterrupt') {
        if (typeof value !== 'boolean') throw new Error('Invalid social turn options.');
      } else if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 60000
      ) {
        throw new Error('Invalid social turn options.');
      }
    }
    for (const value of [
      this.settings.rateWindowMs,
      this.settings.maxActorTurns,
      this.settings.maxChannelTurns,
      this.settings.maxChannels,
      this.settings.maxActorsPerChannel,
      this.settings.maxWaitMs,
    ]) {
      if (value < 1) throw new Error('Invalid social turn options.');
    }
  }
  public now(): number {
    const value = this.readClock();
    if (!Number.isFinite(value)) throw new Error('Invalid social turn clock.');
    this.clock = Math.max(this.clock, value);
    return this.clock;
  }
  public get maxWaitMs(): number {
    return this.settings.maxWaitMs;
  }
  public clear(): void {
    this.channels.clear();
  }
  public admit(input: {
    key: string;
    actorId: string;
    owner: boolean;
    addressed: boolean;
    direct: boolean;
    busy: boolean;
    eligible: boolean;
  }): SocialTurnDecision {
    const now = this.now();
    const retention = Math.max(
      this.settings.rateWindowMs,
      this.settings.channelCooldownMs,
      this.settings.directCooldownMs,
      this.settings.maxWaitMs,
    );
    for (const [key, channel] of this.channels) {
      if (now - channel.lastObservedAt > retention) this.channels.delete(key);
    }
    let channel = this.channels.get(input.key);
    if (!input.eligible) {
      if (channel) {
        channel.observed = Math.min(1000000, channel.observed + 1);
      }
      return { action: 'listen', reason: 'unaddressed' };
    }
    if (!channel) {
      if (this.channels.size >= this.settings.maxChannels)
        return { action: 'ignore', reason: 'context-capacity' };
      channel = { hits: [], actors: new Map(), lastObservedAt: now, observed: 0 };
      this.channels.set(input.key, channel);
    }
    channel.lastObservedAt = now;
    channel.observed = Math.min(1000000, channel.observed + 1);
    const cutoff = now - this.settings.rateWindowMs;
    channel.hits = channel.hits.filter((at) => at > cutoff);
    for (const [actor, hits] of channel.actors) {
      const current = hits.filter((at) => at > cutoff);
      if (current.length) channel.actors.set(actor, current);
      else channel.actors.delete(actor);
    }
    const actorHits = channel.actors.get(input.actorId) ?? [];
    if (actorHits.length >= this.settings.maxActorTurns)
      return { action: 'ignore', reason: 'actor-rate-limit' };
    if (channel.hits.length >= this.settings.maxChannelTurns)
      return { action: 'ignore', reason: 'channel-rate-limit' };
    if (
      !channel.actors.has(input.actorId) &&
      channel.actors.size >= this.settings.maxActorsPerChannel
    )
      return { action: 'ignore', reason: 'context-capacity' };
    actorHits.push(now);
    channel.actors.set(input.actorId, actorHits);
    channel.hits.push(now);
    const priority =
      (input.addressed ? 10 : 0) + (input.owner && this.settings.ownerPriority ? 20 : 0);
    if (input.busy && input.owner && this.settings.ownerInterrupt)
      return { action: 'interrupt', priority: priority + 40 };
    return {
      action: input.busy || this.delay(input.key, input.direct) > 0 ? 'wait' : 'answer',
      priority,
    };
  }
  public delay(key: string, direct: boolean): number {
    const finished = this.channels.get(key)?.finishedAt;
    return finished === undefined
      ? 0
      : Math.max(
          0,
          finished +
            (direct ? this.settings.directCooldownMs : this.settings.channelCooldownMs) -
            this.now(),
        );
  }
  public finish(key: string): void {
    const channel = this.channels.get(key);
    if (channel) channel.finishedAt = channel.lastObservedAt = this.now();
  }
}

export function waitForSocialTurn(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Social turn cancelled.'));
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      resolve();
    };
    const cancel = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      reject(new Error('Social turn cancelled.'));
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', cancel, { once: true });
  });
}
