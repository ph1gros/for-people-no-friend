import type { CharacterProfile } from '../../core/conversation/character-profile';
import type { SocialConversationPort } from '../../core/social/social-conversation-router';
import type { SocialPresenceService } from './social-presence-service';

export interface DisposablePort extends SocialConversationPort {
  dispose(): void;
}

export interface SocialSession {
  characterId: string;
  service: SocialPresenceService;
  port: DisposablePort;
  detachState?: () => void;
}

export interface SocialSessionManagerOptions {
  getProfile(): Promise<CharacterProfile>;
  /** Single public error string for this platform; upstream detail never crosses the boundary. */
  publicError: string;
}

/**
 * Platform-independent half of a presence controller: one live session at a time, an epoch that
 * invalidates in-flight work the moment configuration or the active character changes, and a
 * serial queue so two IPC calls cannot interleave against the same session.
 *
 * A platform controller supplies only what is platform-specific — which configuration to read and
 * how to build the adapter — so adding a platform does not duplicate this lifecycle.
 */
export class SocialSessionManager {
  private current?: SocialSession;
  private generation = 0;
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();

  public constructor(private readonly options: SocialSessionManagerOptions) {}

  public get epoch(): number {
    return this.generation;
  }

  public get session(): SocialSession | undefined {
    return this.current;
  }

  public isCurrent(session: SocialSession): boolean {
    return this.current === session;
  }

  public adopt(session: SocialSession): void {
    this.current = session;
  }

  /** Called before character edits, switching, setup and shutdown. Cancellation is synchronous. */
  public stop(): number {
    this.generation += 1;
    this.clearSession();
    return this.generation;
  }

  public dispose(): void {
    this.disposed = true;
    this.stop();
  }

  public clearSession(): void {
    const session = this.current;
    this.current = undefined;
    if (!session) return;
    session.detachState?.();
    session.service.stop();
    session.port.dispose();
    void session.service.dispose().catch(() => undefined);
  }

  /**
   * Confirms the operation still belongs to the character it started for. A superseded epoch, a
   * disposed controller or a switched character all abort, and a switch also tears the session
   * down so a stale connection cannot outlive its character.
   */
  public async requireActive(characterId: string, epoch: number): Promise<CharacterProfile> {
    if (this.disposed || epoch !== this.generation) throw new Error(this.options.publicError);
    const profile = await this.options.getProfile();
    if (profile.id !== characterId || this.disposed || epoch !== this.generation) {
      if (epoch === this.generation) this.stop();
      throw new Error(this.options.publicError);
    }
    return structuredClone(profile);
  }

  /** Drops the session when the active character no longer matches it. */
  public async activeProfile(): Promise<CharacterProfile> {
    const profile = await this.options.getProfile();
    if (this.current && this.current.characterId !== profile.id) this.stop();
    return profile;
  }

  public serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
