import { KookAdapter, type KookAdapterOptions } from '../../adapters/social/kook/kook-adapter';
import type { CharacterProfile } from '../../core/conversation/character-profile';
import { createDefaultSocialPresenceConfig } from '../../core/social/social-account-config';
import { randomUUID } from 'node:crypto';
import type { SocialPlatformAdapter, SocialVoiceSession } from '../../core/social/social-contracts';
import type { SpeechService } from '../speech/speech-service';
import {
  KOOK_PRESENCE_PUBLIC_ERROR,
  parseKookSettingsInput,
  parseKookVoiceInput,
  type KookVoiceInput,
  parseQqCharacterInput,
  type KookPresenceSnapshot,
  type KookSettingsInput,
} from '../../shared/social-ipc';
import type { KookIpcController } from '../ipc/register-social-ipc-handlers';
import type { SenderValidationWindow } from '../ipc/sender-validation';
import type { SocialConfigStore } from './social-config-store';
import { SocialPresenceService } from './social-presence-service';
import {
  SocialSessionManager,
  type DisposablePort,
  type SocialSession,
} from './social-session-manager';

export interface KookPresenceControllerOptions {
  speech?: Pick<SpeechService, 'synthesize' | 'cancel'>;
  store: Pick<
    SocialConfigStore,
    | 'getKook'
    | 'saveKook'
    | 'getKookToken'
    | 'deleteKookSecret'
    | 'getKookOwnerTokens'
    | 'getIdentitySalt'
  >;
  getProfile(): Promise<CharacterProfile>;
  getWindow(): SenderValidationWindow | undefined;
  createPort(profile: CharacterProfile): DisposablePort;
  createAdapter?: (options: KookAdapterOptions) => SocialPlatformAdapter;
}

/**
 * Single opt-in KOOK connection, bound to a profile snapshot. No startup network or secret reads.
 * The session lifecycle is shared with the QQ controller; only reading configuration and building
 * the adapter are platform-specific.
 */
export class KookPresenceController implements KookIpcController {
  private readonly sessions: SocialSessionManager;
  private adapter?: SocialPlatformAdapter;
  private voice?: SocialVoiceSession;
  private voiceAbort?: AbortController;
  private voiceBusy = false;

  private stopVoice(): void {
    this.voiceAbort?.abort();
    this.voiceAbort = undefined;
    const voice = this.voice;
    this.voice = undefined;
    void voice?.leave().catch(() => undefined);
  }

  public async controlVoice(input: KookVoiceInput): Promise<KookPresenceSnapshot> {
    const parsed = parseKookVoiceInput(input);
    const epoch = this.sessions.epoch;
    await this.sessions.requireActive(parsed.characterId, epoch);
    if (parsed.action === 'leave') {
      this.stopVoice();
      return this.snapshot(parsed.characterId);
    }
    if (this.voiceBusy || this.sessions.session?.service.presence()[0]?.state !== 'online') {
      throw new Error(KOOK_PRESENCE_PUBLIC_ERROR);
    }
    this.voiceBusy = true;
    try {
      if (parsed.action === 'join') {
        if (this.voice || !this.adapter?.joinVoice) throw new Error(KOOK_PRESENCE_PUBLIC_ERROR);
        const pending = new AbortController();
        this.voiceAbort = pending;
        const voice = await this.adapter.joinVoice({
          platform: 'kook',
          channelKind: 'channel',
          channelId: parsed.channelId,
        });
        if (pending.signal.aborted || this.sessions.epoch !== epoch) {
          await voice.leave();
          throw new Error(KOOK_PRESENCE_PUBLIC_ERROR);
        }
        this.voice = voice;
      } else {
        const voice = this.voice;
        const speech = this.options.speech;
        const controller = this.voiceAbort;
        if (!voice?.play || !speech || !controller) throw new Error(KOOK_PRESENCE_PUBLIC_ERROR);
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]);
        const requestId = `kook_voice_${randomUUID()}`;
        const cancel = (): void => {
          speech.cancel(requestId);
        };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          signal.throwIfAborted();
          const spoken = await speech.synthesize({ requestId, text: parsed.text });
          signal.throwIfAborted();
          await this.sessions.requireActive(parsed.characterId, epoch);
          if (!spoken.ok || !['audio/wav', 'audio/x-wav', 'audio/wave'].includes(spoken.mimeType))
            throw new Error(KOOK_PRESENCE_PUBLIC_ERROR);
          await voice.play(spoken.audio, signal);
        } finally {
          signal.removeEventListener('abort', cancel);
        }
      }
      return await this.snapshot(parsed.characterId);
    } catch {
      this.stopVoice();
      throw new Error(KOOK_PRESENCE_PUBLIC_ERROR);
    } finally {
      this.voiceBusy = false;
    }
  }

  public constructor(private readonly options: KookPresenceControllerOptions) {
    this.sessions = new SocialSessionManager({
      getProfile: () => options.getProfile(),
      publicError: KOOK_PRESENCE_PUBLIC_ERROR,
    });
  }

  public getWindow(): SenderValidationWindow | undefined {
    return this.options.getWindow();
  }

  public async getSnapshot(): Promise<KookPresenceSnapshot> {
    const profile = await this.sessions.activeProfile();
    return this.snapshot(profile.id);
  }

  public save(input: KookSettingsInput): Promise<KookPresenceSnapshot> {
    const parsed = parseKookSettingsInput(input);
    // Invalidate a pending connect immediately; it must not revive a superseded configuration.
    const epoch = this.stop();
    return this.sessions.serialize(async () => {
      await this.sessions.requireActive(parsed.characterId, epoch);
      await this.options.store.saveKook(parsed);
      return this.snapshot(parsed.characterId);
    });
  }

  public connect(characterId: string): Promise<KookPresenceSnapshot> {
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
      const configuration = await this.options.store.getKook(characterId);
      if (!configuration.enabled || !configuration.hasToken) {
        throw new Error(KOOK_PRESENCE_PUBLIC_ERROR);
      }
      const [identitySalt, ownerTokens] = await Promise.all([
        this.options.store.getIdentitySalt(),
        this.options.store.getKookOwnerTokens(characterId),
      ]);
      await this.sessions.requireActive(characterId, epoch);
      this.sessions.clearSession();

      const port = this.options.createPort(profile);
      const config = createDefaultSocialPresenceConfig(characterId);
      const account = config.accounts.find((entry) => entry.platform === 'kook');
      if (!account) throw new Error(KOOK_PRESENCE_PUBLIC_ERROR);
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
      for (const token of ownerTokens) service.directory.bindToken('kook', token, 'owner');
      const session: SocialSession = { characterId, service, port };
      this.sessions.adopt(session);
      try {
        const adapter = (this.options.createAdapter ?? ((options) => new KookAdapter(options)))({
          getToken: async () => {
            await this.sessions.requireActive(characterId, epoch);
            const token = await this.options.store.getKookToken(characterId);
            if (!token) throw new Error(KOOK_PRESENCE_PUBLIC_ERROR);
            return token;
          },
          onReady: (id) => service.setSelfUserId('kook', id),
          voiceChannelEnabled: true,
        });
        this.adapter = adapter;
        service.registerAdapter(adapter);
        session.detachState = adapter.onStateChange?.((state) => {
          if (!this.sessions.isCurrent(session)) return;
          if (state === 'online') service.start();
          else {
            this.stopVoice();
            service.stop();
          }
        });
        await service.connect('kook');
        await this.sessions.requireActive(characterId, epoch);
        return this.snapshot(characterId);
      } catch {
        if (this.sessions.isCurrent(session)) this.sessions.clearSession();
        throw new Error(KOOK_PRESENCE_PUBLIC_ERROR);
      }
    });
  }

  public async disconnect(characterId: string): Promise<KookPresenceSnapshot> {
    parseQqCharacterInput({ characterId });
    await this.sessions.requireActive(characterId, this.sessions.epoch);
    this.stop();
    return this.snapshot(characterId);
  }

  public deleteSecret(characterId: string): Promise<KookPresenceSnapshot> {
    parseQqCharacterInput({ characterId });
    const epoch = this.stop();
    return this.sessions.serialize(async () => {
      await this.sessions.requireActive(characterId, epoch);
      await this.options.store.deleteKookSecret(characterId);
      return this.snapshot(characterId);
    });
  }

  /** Called before character edits, switching, setup, and shutdown. Cancellation is synchronous. */
  public stop(): number {
    this.stopVoice();
    this.adapter = undefined;
    return this.sessions.stop();
  }

  public dispose(): void {
    this.stopVoice();
    this.sessions.dispose();
  }

  private async snapshot(characterId: string): Promise<KookPresenceSnapshot> {
    const configuration = await this.options.store.getKook(characterId);
    const state =
      this.sessions.session?.characterId === characterId
        ? (this.sessions.session.service.presence()[0]?.state ?? 'offline')
        : configuration.hasToken
          ? 'offline'
          : 'not-configured';
    return {
      configuration,
      state,
      ...(state === 'error' ? { errorMessage: KOOK_PRESENCE_PUBLIC_ERROR } : {}),
    };
  }
}
