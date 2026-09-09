import {
  OneBotAdapter,
  type OneBotAdapterOptions,
} from '../../adapters/social/onebot/onebot-adapter';
import type { CharacterProfile } from '../../core/conversation/character-profile';
import { createDefaultSocialPresenceConfig } from '../../core/social/social-account-config';
import type { SocialPlatformAdapter } from '../../core/social/social-contracts';
import {
  OOPZ_PRESENCE_PUBLIC_ERROR,
  parseOopzSettingsInput,
  parseOopzStartInput,
  parseQqCharacterInput,
  type OopzPresenceSnapshot,
  type OopzSettingsInput,
  type OopzStartInput,
} from '../../shared/social-ipc';
import type { OopzIpcController } from '../ipc/register-social-ipc-handlers';
import type { SenderValidationWindow } from '../ipc/sender-validation';
import type { OopzBridgeManager } from './oopz-bridge-manager';
import type { SocialConfigStore } from './social-config-store';
import { SocialPresenceService } from './social-presence-service';
import {
  SocialSessionManager,
  type DisposablePort,
  type SocialSession,
} from './social-session-manager';

export interface OopzPresenceControllerOptions {
  store: Pick<SocialConfigStore, 'getOopz' | 'saveOopz' | 'getOopzOwnerTokens' | 'getIdentitySalt'>;
  bridge: Pick<
    OopzBridgeManager,
    'snapshot' | 'save' | 'start' | 'stop' | 'deleteCredentials' | 'dispose'
  >;
  getProfile(): Promise<CharacterProfile>;
  getWindow(): SenderValidationWindow | undefined;
  createPort(profile: CharacterProfile): DisposablePort;
  createAdapter?: (options: OneBotAdapterOptions) => SocialPlatformAdapter;
  /**
   * Whether an audited bridge runtime is wired at composition time. The bridge manager fails
   * closed without one, so the settings page needs to say why starting is impossible.
   */
  isRuntimeAvailable(): boolean;
}

/**
 * Experimental Oopz presence. Unlike QQ and KOOK this has **two** independent lifecycles:
 *
 * 1. the bridge process, owned by `OopzBridgeManager`; and
 * 2. the OneBot connection to it, owned by the shared session manager.
 *
 * They are deliberately driven by separate user actions. A running process does not mean the
 * bridge logged in or that OneBot is ready, and there is no readiness handshake yet — so the
 * controller never auto-connects after a start, and never auto-starts on connect.
 */
export class OopzPresenceController implements OopzIpcController {
  private readonly sessions: SocialSessionManager;
  private bridgeStop: Promise<void> = Promise.resolve();
  private bridgeStopGeneration = 0;

  public constructor(private readonly options: OopzPresenceControllerOptions) {
    this.sessions = new SocialSessionManager({
      getProfile: () => options.getProfile(),
      publicError: OOPZ_PRESENCE_PUBLIC_ERROR,
    });
  }

  public getWindow(): SenderValidationWindow | undefined {
    return this.options.getWindow();
  }

  public async getSnapshot(): Promise<OopzPresenceSnapshot> {
    const profile = await this.sessions.activeProfile();
    return this.snapshot(profile.id);
  }

  public save(input: OopzSettingsInput): Promise<OopzPresenceSnapshot> {
    const parsed = parseOopzSettingsInput(input);
    // Invalidate a pending connect immediately; it must not revive a superseded configuration.
    const epoch = this.sessions.stop();
    return this.sessions.serialize(async () => {
      await this.sessions.requireActive(parsed.characterId, epoch);
      await this.options.store.saveOopz(parsed);
      if (parsed.account !== undefined && parsed.password !== undefined) {
        // The bridge manager owns the credential and re-checks the accepted warning itself.
        await this.options.bridge.save({
          characterId: parsed.characterId,
          acceptedWarningVersion: parsed.acceptedWarningVersion,
          account: parsed.account,
          password: parsed.password,
        });
      }
      return this.snapshot(parsed.characterId);
    });
  }

  public startBridge(input: OopzStartInput): Promise<OopzPresenceSnapshot> {
    const parsed = parseOopzStartInput(input);
    const epoch = this.sessions.epoch;
    const stopGeneration = this.bridgeStopGeneration;
    return this.sessions.serialize(async () => {
      try {
        await this.bridgeStop;
      } catch {
        // Retry failed teardown, never launch past it or cache its rejection forever.
        await this.stopOwnedBridge();
      }
      await this.sessions.requireActive(parsed.characterId, epoch);
      if (!this.options.isRuntimeAvailable()) throw new Error(OOPZ_PRESENCE_PUBLIC_ERROR);
      try {
        await this.options.bridge.start(parsed);
        await this.sessions.requireActive(parsed.characterId, epoch);
      } catch {
        if (stopGeneration === this.bridgeStopGeneration) {
          throw new Error(OOPZ_PRESENCE_PUBLIC_ERROR);
        }
        // A stop cancels startup, but is not a startup failure. Do not return another
        // character's snapshot, or hide a teardown failure behind a successful cancellation.
        await this.bridgeStop;
        await this.sessions.requireActive(parsed.characterId, this.sessions.epoch);
        const snapshot = await this.snapshot(parsed.characterId);
        if (snapshot.bridge !== 'stopped') throw new Error(OOPZ_PRESENCE_PUBLIC_ERROR);
        return snapshot;
      }
      return this.snapshot(parsed.characterId);
    });
  }

  public async stopBridge(characterId: string): Promise<OopzPresenceSnapshot> {
    parseQqCharacterInput({ characterId });
    await this.sessions.requireActive(characterId, this.sessions.epoch);
    // Do not queue cancellation behind the very start operation it must interrupt.
    const epoch = this.stop();
    const stopped = this.bridgeStop;
    return this.sessions.serialize(async () => {
      // Cancellation is immediate; acknowledgement waits for the interrupted start
      // to settle and clean up any child adopted during a reentrant launch callback.
      await stopped;
      await this.sessions.requireActive(characterId, epoch);
      return this.snapshot(characterId);
    });
  }

  public connect(characterId: string): Promise<OopzPresenceSnapshot> {
    parseQqCharacterInput({ characterId });
    const epoch = this.sessions.epoch;
    return this.sessions.serialize(async () => {
      const profile = await this.sessions.requireActive(characterId, epoch);
      if (
        this.sessions.session?.characterId === characterId &&
        this.sessions.session.service.presence()[0]?.state === 'online'
      ) {
        return this.snapshot(characterId);
      }
      const stored = await this.options.store.getOopz(characterId);
      const bridge = await this.options.bridge.snapshot(characterId);
      // Connecting only makes sense against a live bridge the user already started.
      if (!stored.enabled || !stored.onebotUrl || bridge.state !== 'running') {
        throw new Error(OOPZ_PRESENCE_PUBLIC_ERROR);
      }
      const [identitySalt, ownerTokens] = await Promise.all([
        this.options.store.getIdentitySalt(),
        this.options.store.getOopzOwnerTokens(characterId),
      ]);
      await this.sessions.requireActive(characterId, epoch);
      this.sessions.clearSession();

      const port = this.options.createPort(profile);
      const config = createDefaultSocialPresenceConfig(characterId);
      const account = config.accounts.find((entry) => entry.platform === 'oopz');
      if (!account) throw new Error(OOPZ_PRESENCE_PUBLIC_ERROR);
      account.enabled = true;

      const service = new SocialPresenceService({
        config,
        identitySalt,
        getCharacterNamespace: () => profile.memoryNamespace,
        port: {
          respond: async (request) => {
            await this.sessions.requireActive(characterId, epoch);
            const reply = await port.respond(request);
            await this.sessions.requireActive(characterId, epoch);
            return reply;
          },
        },
      });
      for (const token of ownerTokens) service.directory.bindToken('oopz', token, 'owner');
      const session: SocialSession = { characterId, service, port };
      this.sessions.adopt(session);
      try {
        const adapter = (this.options.createAdapter ?? ((options) => new OneBotAdapter(options)))({
          url: stored.onebotUrl,
          onReady: (id) => service.setSelfUserId('oopz', id),
        });
        service.registerAdapter(adapter);
        session.detachState = adapter.onStateChange?.((state) => {
          if (!this.sessions.isCurrent(session)) return;
          if (state === 'online') service.start();
          else service.stop();
        });
        await service.connect('oopz');
        await this.sessions.requireActive(characterId, epoch);
        return this.snapshot(characterId);
      } catch {
        if (this.sessions.isCurrent(session)) this.sessions.clearSession();
        throw new Error(OOPZ_PRESENCE_PUBLIC_ERROR);
      }
    });
  }

  public async disconnect(characterId: string): Promise<OopzPresenceSnapshot> {
    parseQqCharacterInput({ characterId });
    await this.sessions.requireActive(characterId, this.sessions.epoch);
    this.sessions.stop();
    return this.snapshot(characterId);
  }

  public deleteSecret(characterId: string): Promise<OopzPresenceSnapshot> {
    parseQqCharacterInput({ characterId });
    const epoch = this.sessions.stop();
    return this.sessions.serialize(async () => {
      await this.sessions.requireActive(characterId, epoch);
      await this.options.bridge.deleteCredentials(characterId);
      return this.snapshot(characterId);
    });
  }

  /** Called before character edits, switching, setup, and shutdown. Cancellation is synchronous. */
  public stop(): number {
    const epoch = this.sessions.stop();
    this.bridgeStopGeneration += 1;
    void this.stopOwnedBridge();
    return epoch;
  }

  private stopOwnedBridge(): Promise<void> {
    try {
      this.bridgeStop = this.options.bridge.stop().catch(() => {
        throw new Error(OOPZ_PRESENCE_PUBLIC_ERROR);
      });
    } catch {
      this.bridgeStop = Promise.reject(new Error(OOPZ_PRESENCE_PUBLIC_ERROR));
    }
    // Synchronous character-change hooks cannot await; later starts still wait for teardown.
    void this.bridgeStop.catch(() => undefined);
    return this.bridgeStop;
  }

  public async dispose(): Promise<void> {
    this.sessions.dispose();
    try {
      await this.bridgeStop;
    } finally {
      await this.options.bridge.dispose();
    }
  }

  private async snapshot(characterId: string): Promise<OopzPresenceSnapshot> {
    const [stored, bridge] = await Promise.all([
      this.options.store.getOopz(characterId),
      this.options.bridge.snapshot(characterId),
    ]);
    const state =
      this.sessions.session?.characterId === characterId
        ? (this.sessions.session.service.presence()[0]?.state ?? 'offline')
        : stored.onebotUrl
          ? 'offline'
          : 'not-configured';
    return {
      configuration: {
        characterId,
        enabled: stored.enabled,
        onebotUrl: stored.onebotUrl,
        ownerBindingCount: stored.ownerBindingCount,
        hasCredentials: bridge.hasCredentials,
        runtimeAvailable: this.options.isRuntimeAvailable(),
      },
      bridge: bridge.state,
      state,
      ...(state === 'error' || bridge.state === 'error'
        ? { errorMessage: OOPZ_PRESENCE_PUBLIC_ERROR }
        : {}),
    };
  }
}
