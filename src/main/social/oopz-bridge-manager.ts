import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  OOPZ_BRIDGE_ERROR,
  OOPZ_BRIDGE_WARNING,
  parseOopzBridgeCredentials,
  parseOopzBridgeSave,
  parseOopzBridgeStart,
  type OopzBridgeSnapshot,
  type OopzBridgeState,
} from '../../shared/oopz-bridge';
import { parseCharacterIdInput } from '../../shared/character-package-ipc';
import type { SecretStore } from '../security/secret-store';
import { createChildEnvironment } from '../security/child-environment';

/** Trusted Main composition only. No executable, arguments or paths may come from IPC. */
export interface OopzManagedRuntime {
  /** Fixed audited entry, shell:false, windowsHide:true, pipe stdio, no detached process. */
  launch(environment: NodeJS.ProcessEnv): ChildProcess;
  /** Terminates the entire owned process tree, never processes selected by name. */
  terminate(child: ChildProcess, force: boolean): Promise<void>;
}
interface Options {
  secrets: Pick<SecretStore, 'get' | 'has' | 'set' | 'delete'>;
  getActiveCharacterId(): Promise<string>;
  /** Absent until a runtime and its tree teardown are audited. Fail closed. */
  runtime?: OopzManagedRuntime;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}
export const oopzCredentialId = (characterId: string): string => {
  parseCharacterIdInput({ characterId });
  return `oopz-${createHash('sha256').update(characterId).digest('hex').slice(0, 48)}`;
};

/** Process liveness only: running does NOT mean logged in or OneBot-ready. */
export class OopzBridgeManager {
  private child?: ChildProcess;
  private characterId?: string;
  private state: OopzBridgeState = 'stopped';
  private epoch = 0;
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();
  private cancelStartup?: () => void;
  private stopPending?: Promise<void>;
  public constructor(private readonly options: Options) {}

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(work, work);
    this.queue = pending.catch(() => undefined);
    return pending;
  }
  private async requireActive(characterId: string, epoch: number): Promise<void> {
    const active = await this.options.getActiveCharacterId().catch(() => {
      throw new Error(OOPZ_BRIDGE_ERROR);
    });
    if (active !== characterId) void this.stop();
    if (this.disposed || active !== characterId || epoch !== this.epoch)
      throw new Error(OOPZ_BRIDGE_ERROR);
  }
  public async snapshot(characterId: string): Promise<OopzBridgeSnapshot> {
    parseCharacterIdInput({ characterId });
    const epoch = this.epoch;
    await this.requireActive(characterId, epoch);
    try {
      const hasCredentials = await this.options.secrets.has(oopzCredentialId(characterId));
      await this.requireActive(characterId, epoch);
      const state = this.characterId === characterId ? this.state : 'stopped';
      return {
        characterId,
        state,
        hasCredentials,
        experimental: true,
        warning: OOPZ_BRIDGE_WARNING,
        ...(state === 'error' ? { errorMessage: OOPZ_BRIDGE_ERROR } : {}),
      };
    } catch {
      throw new Error(OOPZ_BRIDGE_ERROR);
    }
  }
  public save(value: unknown): Promise<void> {
    const input = parseOopzBridgeSave(value);
    const epoch = this.epoch;
    return this.serialize(async () => {
      await this.requireActive(input.characterId, epoch);
      const stopped = this.stop();
      const afterStop = this.epoch;
      await stopped;
      await this.requireActive(input.characterId, afterStop);
      try {
        if (this.child) throw new Error(OOPZ_BRIDGE_ERROR);
        await this.options.secrets.set(
          oopzCredentialId(input.characterId),
          JSON.stringify({ account: input.account, password: input.password }),
        );
      } catch {
        throw new Error(OOPZ_BRIDGE_ERROR);
      }
    });
  }
  public deleteCredentials(characterId: string): Promise<void> {
    parseCharacterIdInput({ characterId });
    const epoch = this.epoch;
    return this.serialize(async () => {
      await this.requireActive(characterId, epoch);
      const stopped = this.stop();
      const afterStop = this.epoch;
      await stopped;
      await this.requireActive(characterId, afterStop);
      try {
        await this.options.secrets.delete(oopzCredentialId(characterId));
      } catch {
        throw new Error(OOPZ_BRIDGE_ERROR);
      }
    });
  }
  public start(value: unknown): Promise<void> {
    const input = parseOopzBridgeStart(value);
    const epoch = this.epoch;
    return this.serialize(async () => {
      await this.requireActive(input.characterId, epoch);
      if (this.child) {
        if (this.characterId === input.characterId && this.state === 'running') return;
        throw new Error(OOPZ_BRIDGE_ERROR);
      }
      const runtime = this.options.runtime;
      this.characterId = input.characterId;
      try {
        if (!runtime || this.stopPending) throw new Error(OOPZ_BRIDGE_ERROR);
        const stored = await this.options.secrets.get(oopzCredentialId(input.characterId));
        await this.requireActive(input.characterId, epoch);
        const credentials = parseOopzBridgeCredentials(JSON.parse(stored ?? 'null') as unknown);
        this.state = 'starting';
        const child = runtime.launch(
          createChildEnvironment(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'], {
            OOPZ_LOGIN_PHONE: credentials.account,
            OOPZ_LOGIN_PASSWORD: credentials.password,
            PYTHONNOUSERSITE: '1',
            PYTHONUNBUFFERED: '1',
          }),
        );
        this.child = child;
        for (const stream of [child.stdin, child.stdout, child.stderr]) {
          stream?.on('error', () => {
            /* Process exit/error is handled separately; never leak pipe diagnostics. */
          });
        }
        // Drain SDK output without parsing, retaining or logging credentials/private messages.
        child.stdout?.resume();
        child.stderr?.resume();
        child.stdin?.end();
        child.on('error', () => {
          if (this.child !== child) return;
          this.state = 'error';
          this.cancelStartup?.();
          const stopped = this.stop();
          const failedEpoch = this.epoch;
          void stopped.then(() => {
            if (this.epoch === failedEpoch) this.state = 'error';
          });
        });
        child.once('close', () => {
          if (this.child !== child) return;
          this.cancelStartup?.();
          this.child = undefined;
          this.state = this.state === 'stopping' ? 'stopped' : 'error';
        });
        // launch is synchronous, but an injected runtime may reenter stop(). Adopt
        // and observe the returned child before checking cancellation so it cannot escape.
        if (this.disposed || epoch !== this.epoch) throw new Error(OOPZ_BRIDGE_ERROR);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => finish(false), this.options.startupTimeoutMs ?? 20000);
          const spawned = (): void => finish(true);
          const finish = (ok: boolean): void => {
            clearTimeout(timer);
            child.removeListener('spawn', spawned);
            this.cancelStartup = undefined;
            if (ok) resolve();
            else reject(new Error(OOPZ_BRIDGE_ERROR));
          };
          this.cancelStartup = () => finish(false);
          child.once('spawn', spawned);
        });
        await this.requireActive(input.characterId, epoch);
        if (this.child !== child) throw new Error(OOPZ_BRIDGE_ERROR);
        this.state = 'running';
      } catch {
        const cancelled = epoch !== this.epoch && this.state !== 'error';
        await this.stop();
        if (!cancelled || this.child) this.state = 'error';
        throw new Error(OOPZ_BRIDGE_ERROR);
      }
    });
  }
  /** Call before switching profiles and await during shutdown. Never automatically restarts. */
  public stop(): Promise<void> {
    this.epoch += 1;
    this.cancelStartup?.();
    if (this.stopPending) return this.stopPending;
    const child = this.child;
    if (!child) {
      this.state = 'stopped';
      return Promise.resolve();
    }
    this.state = 'stopping';
    const task = async (): Promise<void> => {
      const waitForClose = (): Promise<void> =>
        new Promise((resolve) => {
          if (this.child !== child) {
            resolve();
            return;
          }
          const done = (): void => {
            clearTimeout(timer);
            child.removeListener('close', done);
            resolve();
          };
          const timer = setTimeout(done, this.options.shutdownTimeoutMs ?? 2000);
          child.once('close', done);
        });
      for (const force of [false, true]) {
        if (this.child !== child) break;
        const closed = waitForClose();
        void Promise.resolve()
          .then(() => this.options.runtime?.terminate(child, force))
          .catch(() => undefined);
        await closed;
      }
      if (this.child === child) this.state = 'error'; // Retain ownership; forbid duplicate launch.
    };
    this.stopPending = task().finally(() => {
      this.stopPending = undefined;
    });
    return this.stopPending;
  }
  public async dispose(): Promise<void> {
    this.disposed = true;
    await this.stop();
  }
}
