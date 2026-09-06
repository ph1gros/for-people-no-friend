import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_SETUP_STATE,
  SETUP_STATE_VERSION,
  parseSetupState,
  type SetupCompletionSource,
  type SetupState,
  type SetupProgress,
  type SetupStepId,
} from '../../shared/setup-ipc';

export class SetupStateStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly userDataPath: string) {
    this.filePath = path.join(userDataPath, 'setup.v1.json');
  }

  /**
   * Returns the persisted first-run marker. A missing or unreadable file is treated as an
   * incomplete setup so that a damaged marker never blocks the application from starting.
   */
  public async get(): Promise<SetupState> {
    await this.writeQueue;
    try {
      return parseSetupState(JSON.parse(await readFile(this.filePath, 'utf8')) as unknown);
    } catch {
      return { ...DEFAULT_SETUP_STATE };
    }
  }

  public markCompleted(
    completedBy: SetupCompletionSource,
    completedAt: Date = new Date(),
  ): Promise<SetupState> {
    const state: SetupState = {
      version: SETUP_STATE_VERSION,
      completed: true,
      completedAt: completedAt.toISOString(),
      completedBy,
    };
    return this.write(state);
  }

  public reset(): Promise<SetupState> {
    return this.write({ ...DEFAULT_SETUP_STATE });
  }

  /**
   * Records where the wizard is, without touching the completion marker: rerunning setup on a
   * configured installation must not put it back into first-run state if the user abandons it.
   */
  public async saveProgress(progress: SetupProgress): Promise<SetupState> {
    const current = await this.get();
    return this.write({
      version: SETUP_STATE_VERSION,
      completed: current.completed,
      ...(current.completedAt ? { completedAt: current.completedAt } : {}),
      ...(current.completedBy ? { completedBy: current.completedBy } : {}),
      progress,
    });
  }

  public async recordFailure(step: SetupStepId): Promise<void> {
    const file = path.join(this.userDataPath, 'setup-diagnostic.v1.json');
    try {
      await mkdir(this.userDataPath, { recursive: true });
      await writeFile(
        `${file}.tmp`,
        JSON.stringify({
          version: 1,
          step,
          code: 'operation-failed',
          at: new Date().toISOString(),
        }),
        { encoding: 'utf8', mode: 0o600 },
      );
      await rename(`${file}.tmp`, file);
    } catch {
      /* Diagnostic failures never block setup. */
    }
  }

  private write(state: SetupState): Promise<SetupState> {
    const validated = parseSetupState(state);
    const operation = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(validated, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      try {
        await rename(temporaryPath, this.filePath);
      } catch (error) {
        await rm(temporaryPath, { force: true });
        throw error;
      }
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation.then(() => ({ ...validated }));
  }
}
