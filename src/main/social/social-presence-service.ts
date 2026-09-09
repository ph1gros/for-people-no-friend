import {
  parseSocialPresenceConfig,
  type SocialPresenceConfig,
} from '../../core/social/social-account-config';
import {
  SocialConversationRouter,
  type SocialConversationPort,
  type SocialRouterContext,
  type SocialRouterDiagnostic,
} from '../../core/social/social-conversation-router';
import type {
  SocialPlatform,
  SocialPlatformAdapter,
  SocialPresenceEntry,
} from '../../core/social/social-contracts';
import { SocialActorDirectory } from '../../core/social/social-identity';
import {
  SocialAdapterRegistry,
  type SocialRegistryDiagnosticSink,
} from '../../core/social/social-registry';
import type { SocialReplyPolicy } from '../../core/social/social-reply-policy';
import type { SocialTurnOptions } from '../../core/social/social-turn-manager';
import { createSocialIdHasher } from './social-identity-hasher';

export interface SocialPresenceServiceOptions {
  /** Optional Main-owned tuning. Owner priority/interruption are off by default. */
  turnOptions?: SocialTurnOptions;
  /** Per-installation salt for identity tokens, created once and stored with app data. */
  identitySalt: string;
  /** Bridge into the existing character, memory and LLM pipeline. */
  port: SocialConversationPort;
  /** Resolves the memory namespace of the character that owns this presence. */
  getCharacterNamespace: () => string;
  config: SocialPresenceConfig;
  registryDiagnostics?: SocialRegistryDiagnosticSink;
  routerDiagnostics?: (diagnostic: SocialRouterDiagnostic) => void;
}

/**
 * Main-process composition root for Social Presence. It owns the adapter registry, the actor
 * directory and the conversation router, so a platform adapter never reaches into the
 * conversation core by itself.
 *
 * No platform adapter is registered here. Platform implementations arrive in later milestones and
 * are attached explicitly through `registerAdapter`, which keeps the feature inert until a user
 * enables an account.
 */
export class SocialPresenceService {
  public readonly registry: SocialAdapterRegistry;
  public readonly directory: SocialActorDirectory;
  private readonly router: SocialConversationRouter;
  private readonly selfUserIds = new Map<SocialPlatform, string>();
  private config: SocialPresenceConfig;
  private started = false;

  public constructor(private readonly options: SocialPresenceServiceOptions) {
    const hashId = createSocialIdHasher(options.identitySalt);
    this.config = parseSocialPresenceConfig(options.config);
    this.registry = new SocialAdapterRegistry(() => Date.now(), options.registryDiagnostics);
    this.directory = new SocialActorDirectory(hashId);
    this.applyBindings();
    this.router = new SocialConversationRouter({
      registry: this.registry,
      directory: this.directory,
      port: options.port,
      hashId,
      getContext: () => this.context(),
      turnOptions: options.turnOptions,
      ...(options.routerDiagnostics ? { diagnostics: options.routerDiagnostics } : {}),
    });
  }

  /** Replaces the stored configuration and re-derives every binding it implies. */
  public applyConfig(config: SocialPresenceConfig): void {
    const parsed = parseSocialPresenceConfig(config);
    this.router.stop();
    this.config = parsed;
    this.directory.clearBindings();
    this.applyBindings();
    if (this.started) this.router.start();
  }

  public snapshotConfig(): SocialPresenceConfig {
    return parseSocialPresenceConfig(this.config);
  }

  /** Records the account the character itself posts under, so it never answers its own message. */
  public setSelfUserId(platform: SocialPlatform, userId: string): void {
    this.selfUserIds.set(platform, userId);
  }

  public registerAdapter(adapter: SocialPlatformAdapter): void {
    this.registry.register(adapter);
  }

  public async unregisterAdapter(platform: SocialPlatform): Promise<boolean> {
    this.selfUserIds.delete(platform);
    return this.registry.unregister(platform);
  }

  public start(): void {
    this.router.start();
    this.started = true;
  }

  public stop(): void {
    this.router.stop();
    this.started = false;
  }

  public isStarted(): boolean {
    return this.started;
  }

  /** Refuses to connect a platform the user has not enabled for this character. */
  public async connect(platform: SocialPlatform): Promise<SocialPresenceEntry> {
    const account = this.config.accounts.find((entry) => entry.platform === platform);
    if (!account?.enabled) {
      throw new Error(`Social presence for "${platform}" is not enabled.`);
    }
    if (!this.started) this.start();
    return this.registry.connect(platform);
  }

  public async disconnectAll(): Promise<void> {
    await this.registry.disconnectAll();
  }

  public presence(): SocialPresenceEntry[] {
    return this.registry.presence();
  }

  public async dispose(): Promise<void> {
    this.router.dispose();
    this.started = false;
    for (const platform of this.registry.platforms()) {
      await this.registry.unregister(platform);
    }
    this.selfUserIds.clear();
  }

  private applyBindings(): void {
    for (const account of this.config.accounts) {
      for (const userId of account.ownerUserIds) {
        this.directory.bind({ platform: account.platform, userId, actorClass: 'owner' });
      }
    }
    for (const binding of this.config.bindings) {
      this.directory.bind(binding);
    }
  }

  private context(): SocialRouterContext {
    const policies: Partial<Record<SocialPlatform, SocialReplyPolicy>> = {};
    for (const account of this.config.accounts) {
      policies[account.platform] = account.replyPolicy;
    }
    return {
      characterNamespace: this.options.getCharacterNamespace(),
      selfUserIds: Object.fromEntries(this.selfUserIds) as Partial<Record<SocialPlatform, string>>,
      policies,
    };
  }
}
