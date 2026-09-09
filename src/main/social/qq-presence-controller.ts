import { QqAdapter, type QqAdapterOptions } from '../../adapters/social/qq/qq-adapter';
import type { CharacterProfile } from '../../core/conversation/character-profile';
import { createDefaultSocialPresenceConfig } from '../../core/social/social-account-config';
import type { SocialPlatformAdapter } from '../../core/social/social-contracts';
import {
  parseQqCharacterInput,
  parseQqSettingsInput,
  QQ_PRESENCE_PUBLIC_ERROR,
  type QqPresenceSnapshot,
  type QqSettingsInput,
} from '../../shared/social-ipc';
import type { SocialIpcController } from '../ipc/register-social-ipc-handlers';
import type { SenderValidationWindow } from '../ipc/sender-validation';
import type { SpeechService } from '../speech/speech-service';
import type { SocialConfigStore } from './social-config-store';
import { SocialPresenceService } from './social-presence-service';
import {
  SocialSessionManager,
  type DisposablePort,
  type SocialSession,
} from './social-session-manager';
import type { SocialVoiceCodec } from './social-voice-codec';
import { createSocialVoiceSynthesizer, type SocialVoiceSynthesizer } from './social-voice-reply';

export interface QqPresenceControllerOptions {
  store: Pick<
    SocialConfigStore,
    'get' | 'save' | 'getCredentials' | 'deleteSecret' | 'getOwnerTokens' | 'getIdentitySalt'
  >;
  getProfile(): Promise<CharacterProfile>;
  getWindow(): SenderValidationWindow | undefined;
  createPort(profile: CharacterProfile, voice?: SocialVoiceSynthesizer): DisposablePort;
  createAdapter?: (options: QqAdapterOptions) => SocialPlatformAdapter;
  /** Optional voice stack. Absent, or an unavailable codec, keeps the presence text-only. */
  voice?: {
    codec: SocialVoiceCodec;
    speech: Pick<SpeechService, 'synthesize' | 'cancel'>;
  };
}

/** Single opt-in connection, bound to a profile snapshot. No startup network or secret reads. */
export class QqPresenceController implements SocialIpcController {
  private readonly sessions: SocialSessionManager;

  public constructor(private readonly options: QqPresenceControllerOptions) {
    this.sessions = new SocialSessionManager({
      getProfile: () => options.getProfile(),
      publicError: QQ_PRESENCE_PUBLIC_ERROR,
    });
  }
  public getWindow(): SenderValidationWindow | undefined {
    return this.options.getWindow();
  }

  public async getSnapshot(): Promise<QqPresenceSnapshot> {
    const profile = await this.sessions.activeProfile();
    return this.snapshot(profile.id);
  }

  public save(input: QqSettingsInput): Promise<QqPresenceSnapshot> {
    const parsed = parseQqSettingsInput(input);
    // Invalidate a pending connect immediately; it must not revive a superseded configuration.
    const epoch = this.stop();
    return this.sessions.serialize(async () => {
      await this.sessions.requireActive(parsed.characterId, epoch);
      await this.options.store.save(parsed);
      return this.snapshot(parsed.characterId);
    });
  }

  public connect(characterId: string): Promise<QqPresenceSnapshot> {
    parseQqCharacterInput({ characterId });
    const epoch = this.sessions.epoch;
    return this.sessions.serialize(async () => {
      const profile = await this.sessions.requireActive(characterId, epoch);
      if (
        this.sessions.session?.characterId === characterId &&
        this.sessions.session.service.presence()[0]?.state === 'online'
      )
        return this.snapshot(characterId);
      const configuration = await this.options.store.get(characterId);
      if (!configuration.enabled || !configuration.appId || !configuration.hasSecret) {
        throw new Error(QQ_PRESENCE_PUBLIC_ERROR);
      }
      const [identitySalt, ownerTokens] = await Promise.all([
        this.options.store.getIdentitySalt(),
        this.options.store.getOwnerTokens(characterId),
      ]);
      // Probing the optional codec before connecting keeps a missing module from turning into a
      // failing send later: the capability is simply never advertised.
      const voiceStack = this.options.voice;
      const voiceReady =
        configuration.voiceReplyEnabled && voiceStack
          ? await voiceStack.codec.isAvailable()
          : false;
      await this.sessions.requireActive(characterId, epoch);
      this.sessions.clearSession();
      const port = this.options.createPort(
        profile,
        voiceReady && voiceStack
          ? createSocialVoiceSynthesizer({
              speech: voiceStack.speech,
              codec: voiceStack.codec,
              isEnabled: () => true,
            })
          : undefined,
      );
      const config = createDefaultSocialPresenceConfig(characterId);
      config.accounts[0]!.enabled = true;
      config.accounts[0]!.accountId = configuration.appId;
      config.accounts[0]!.voiceReplyEnabled = voiceReady;
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
      for (const token of ownerTokens) service.directory.bindToken('qq', token, 'owner');
      const session: SocialSession = { characterId, service, port };
      this.sessions.adopt(session);
      try {
        const adapter = (this.options.createAdapter ?? ((options) => new QqAdapter(options)))({
          appId: configuration.appId,
          getCredentials: async () => {
            await this.sessions.requireActive(characterId, epoch);
            const credentials = await this.options.store.getCredentials(characterId);
            if (!credentials) throw new Error(QQ_PRESENCE_PUBLIC_ERROR);
            return credentials;
          },
          onReady: (id) => service.setSelfUserId('qq', id),
          voiceEnabled: voiceReady,
        });
        service.registerAdapter(adapter);
        session.detachState = adapter.onStateChange?.((state) => {
          if (!this.sessions.isCurrent(session)) return;
          if (state === 'online') service.start();
          else service.stop();
        });
        await service.connect('qq');
        await this.sessions.requireActive(characterId, epoch);
        return this.snapshot(characterId);
      } catch {
        if (this.sessions.isCurrent(session)) this.sessions.clearSession();
        throw new Error(QQ_PRESENCE_PUBLIC_ERROR);
      }
    });
  }

  public async disconnect(characterId: string): Promise<QqPresenceSnapshot> {
    parseQqCharacterInput({ characterId });
    await this.sessions.requireActive(characterId, this.sessions.epoch);
    this.stop();
    return this.snapshot(characterId);
  }

  public deleteSecret(characterId: string): Promise<QqPresenceSnapshot> {
    parseQqCharacterInput({ characterId });
    const epoch = this.stop();
    return this.sessions.serialize(async () => {
      await this.sessions.requireActive(characterId, epoch);
      await this.options.store.deleteSecret(characterId);
      return this.snapshot(characterId);
    });
  }

  /** Called before character edits, switching, setup, and shutdown. Cancellation is synchronous. */
  public stop(): number {
    return this.sessions.stop();
  }

  public dispose(): void {
    this.sessions.dispose();
  }

  private async snapshot(characterId: string): Promise<QqPresenceSnapshot> {
    const configuration = await this.options.store.get(characterId);
    const state =
      this.sessions.session?.characterId === characterId
        ? (this.sessions.session.service.presence()[0]?.state ?? 'offline')
        : configuration.appId && configuration.hasSecret
          ? 'offline'
          : 'not-configured';
    return {
      configuration,
      state,
      ...(state === 'error' ? { errorMessage: QQ_PRESENCE_PUBLIC_ERROR } : {}),
    };
  }
}
