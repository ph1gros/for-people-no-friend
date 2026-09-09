import {
  type SocialMessage,
  type SocialMessageHandler,
  type SocialPlatform,
  type SocialPlatformAdapter,
  type SocialPresenceEntry,
} from './social-contracts';
import { describeSocialError } from './social-redaction';

export type SocialRegistryDiagnosticSink = (
  event:
    'social-adapter-connect-failed' | 'social-adapter-disconnect-failed' | 'social-handler-failed',
  platform: SocialPlatform,
) => void;

interface RegisteredAdapter {
  adapter: SocialPlatformAdapter;
  entry: SocialPresenceEntry;
  detach: () => void;
  generation: number;
}

/**
 * The single place adapters are attached. Platform implementations are added in-repo through this
 * typed registry: there is no runtime discovery, no remote download and no external script
 * loading, and a duplicate platform is a hard failure rather than a silent replacement.
 */
export class SocialAdapterRegistry {
  private readonly adapters = new Map<SocialPlatform, RegisteredAdapter>();
  private readonly handlers = new Set<SocialMessageHandler>();

  public constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly diagnostics?: SocialRegistryDiagnosticSink,
  ) {}

  public register(adapter: SocialPlatformAdapter): void {
    if (this.adapters.has(adapter.platform)) {
      throw new Error(`A social adapter for "${adapter.platform}" is already registered.`);
    }
    const detachMessage = adapter.onMessage((message) => this.dispatch(adapter.platform, message));
    const registered: RegisteredAdapter = {
      adapter,
      generation: 0,
      detach: detachMessage,
      entry: {
        platform: adapter.platform,
        state: 'offline',
        capabilities: adapter.capabilities,
        updatedAt: this.now(),
      },
    };
    this.adapters.set(adapter.platform, registered);
    const detachState = adapter.onStateChange?.((state) => {
      if (this.adapters.get(adapter.platform) !== registered) return;
      this.setState(
        registered,
        state,
        state === 'error' ? 'The social connection is unavailable.' : undefined,
      );
    });
    registered.detach = () => {
      detachMessage();
      detachState?.();
    };
  }

  public async unregister(platform: SocialPlatform): Promise<boolean> {
    const registered = this.adapters.get(platform);
    if (!registered) return false;
    await this.disconnect(platform);
    registered.detach();
    this.adapters.delete(platform);
    return true;
  }

  public get(platform: SocialPlatform): SocialPlatformAdapter | undefined {
    return this.adapters.get(platform)?.adapter;
  }

  public platforms(): SocialPlatform[] {
    return [...this.adapters.keys()];
  }

  public onMessage(handler: SocialMessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Never rejects: a platform that fails to connect degrades to an `error` presence entry. */
  public async connect(platform: SocialPlatform): Promise<SocialPresenceEntry> {
    const registered = this.adapters.get(platform);
    if (!registered) {
      throw new Error(`No social adapter is registered for "${platform}".`);
    }
    const generation = ++registered.generation;
    this.setState(registered, 'connecting');
    try {
      await registered.adapter.connect();
      if (generation !== registered.generation) return { ...registered.entry };
      return this.setState(registered, 'online');
    } catch (error) {
      if (generation !== registered.generation) return { ...registered.entry };
      this.diagnostics?.('social-adapter-connect-failed', platform);
      return this.setState(registered, 'error', describeSocialError(error));
    }
  }

  public async disconnect(platform: SocialPlatform): Promise<SocialPresenceEntry | undefined> {
    const registered = this.adapters.get(platform);
    if (!registered) return undefined;
    const generation = ++registered.generation;
    try {
      await registered.adapter.disconnect();
      if (generation !== registered.generation) return { ...registered.entry };
      return this.setState(registered, 'offline');
    } catch (error) {
      if (generation !== registered.generation) return { ...registered.entry };
      this.diagnostics?.('social-adapter-disconnect-failed', platform);
      return this.setState(registered, 'error', describeSocialError(error));
    }
  }

  public async connectAll(): Promise<SocialPresenceEntry[]> {
    return Promise.all(this.platforms().map((platform) => this.connect(platform)));
  }

  public async disconnectAll(): Promise<void> {
    await Promise.all(this.platforms().map((platform) => this.disconnect(platform)));
  }

  public presence(): SocialPresenceEntry[] {
    return [...this.adapters.values()].map(({ entry }) => ({ ...entry }));
  }

  private setState(
    registered: RegisteredAdapter,
    state: SocialPresenceEntry['state'],
    errorMessage?: string,
  ): SocialPresenceEntry {
    registered.entry = {
      platform: registered.adapter.platform,
      state,
      capabilities: registered.adapter.capabilities,
      updatedAt: this.now(),
      ...(errorMessage ? { errorMessage } : {}),
    };
    return { ...registered.entry };
  }

  private dispatch(platform: SocialPlatform, message: SocialMessage): void {
    for (const handler of [...this.handlers]) {
      try {
        handler(message);
      } catch {
        // A failing consumer must not take down the adapter's event loop.
        this.diagnostics?.('social-handler-failed', platform);
      }
    }
  }
}
