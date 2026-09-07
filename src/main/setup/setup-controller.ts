import {
  SetupFlow,
  createDefaultSetupSteps,
  type SetupSelections,
  type SetupStepDefinition,
} from '../../core/setup/setup-flow';
import type {
  ApplySetupProviderInput,
  SetupCharacterStatus,
  SetupCompletionResult,
  SetupProviderStatus,
  SetupViewState,
  SetupProgress,
} from '../../shared/setup-ipc';
import { SETUP_STATE_VERSION } from '../../shared/setup-ipc';
import type {
  CharacterPackageFileResult,
  ConfirmCharacterPackageImportInput,
} from '../../shared/character-package-ipc';
import type { Live2DModelImportResult } from '../../shared/live2d-model-ipc';
import type {
  ModelOperationResult,
  TestProviderConnectionInput,
  TestProviderConnectionResult,
} from '../../shared/model-ipc';
import type { SetupStateStore } from '../storage/setup-state-store';

import type { SetupServices } from './setup-services';
import type { SetupResourceService } from './setup-resource-service';
import {
  setupResourceIds,
  type SetupResourceControl,
  type SetupResourceStatus,
} from '../../shared/setup-resources';

/** The minimum window surface the controller needs, so the flow stays testable without Electron. */
export interface SetupWindowHandle {
  isDestroyed(): boolean;
  destroy(): void;
  once(event: 'closed', listener: () => void): unknown;
  webContents: { mainFrame: unknown };
}

export interface SetupOutcome {
  completed: boolean;
  launchApp: boolean;
}

export interface SetupControllerOptions<TWindow extends SetupWindowHandle> {
  store: SetupStateStore;
  appVersion: string;
  createWindow: () => TWindow;
  /** Adapters over the services the main application already owns. */
  services?: SetupServices;
  /** True when an already configured installation runs the wizard again on purpose. */
  rerun?: boolean;
  confirmCancel?: (window: TWindow) => Promise<boolean>;
  steps?: SetupStepDefinition[];
  now?: () => Date;
  progress?: SetupProgress;
  resources?: SetupResourceService;
}

/**
 * Owns the authoritative wizard state and the setup window lifetime.
 *
 * Every navigation request is re-evaluated here, so a renderer cannot skip pages, finish early,
 * or keep working after its window is gone.
 */
export class SetupController<TWindow extends SetupWindowHandle = SetupWindowHandle> {
  private readonly flow: SetupFlow;
  private window: TWindow | undefined;
  private outcome: SetupOutcome | undefined;
  private settle: ((outcome: SetupOutcome) => void) | undefined;
  private readonly outcomePromise: Promise<SetupOutcome>;
  private disposed = false;
  private readonly lifetime = new AbortController();
  private navigating = false;
  private readonly providerTests = new Set<string>();

  public constructor(private readonly options: SetupControllerOptions<TWindow>) {
    options.services?.useSession(this.lifetime.signal);
    this.flow = new SetupFlow(
      options.steps ?? createDefaultSetupSteps(),
      options.progress?.selections,
    );
    if (options.progress) this.flow.restore(options.progress.stepId);
    this.outcomePromise = new Promise<SetupOutcome>((resolve) => {
      this.settle = resolve;
    });
  }

  public open(): TWindow {
    if (this.disposed) {
      throw new Error('The setup controller has already been disposed.');
    }
    const existing = this.getWindow();
    if (existing) {
      return existing;
    }
    const window = this.options.createWindow();
    this.window = window;
    window.once('closed', () => {
      this.window = undefined;
      this.stopPendingWork();
      this.resolveOutcome({ completed: false, launchApp: false });
    });
    return window;
  }

  public getWindow(): TWindow | undefined {
    return this.window && !this.window.isDestroyed() ? this.window : undefined;
  }

  public waitForOutcome(): Promise<SetupOutcome> {
    return this.outcomePromise;
  }

  public getViewState(): SetupViewState {
    return {
      ...this.flow.getState(),
      stateVersion: SETUP_STATE_VERSION,
      rerun: this.options.rerun ?? false,
      appVersion: this.options.appVersion,
    };
  }

  public async advance(selections: SetupSelections): Promise<SetupViewState> {
    return this.navigate(async () => {
      this.checkSelectionChange(selections);
      if (this.flow.getState().stepId === 'resources')
        await this.requireResources().requireReady(this.flow.getSelections());
      this.requireActiveSession();
      this.flow.updateSelections(selections);
      this.flow.next();
    });
  }

  public async back(): Promise<SetupViewState> {
    return this.navigate(async () => {
      if (this.flow.getState().stepId === 'resources')
        await this.requireResources().control(
          this.flow.getSelections(),
          { action: 'pause', allowMetered: false },
          this.lifetime.signal,
        );
      this.requireActiveSession();
      this.flow.back();
    });
  }

  public async cancel(): Promise<boolean> {
    const window = this.getWindow();
    if (!window) {
      this.resolveOutcome({ completed: false, launchApp: false });
      return true;
    }
    const confirmed = (await this.options.confirmCancel?.(window)) ?? true;
    if (!confirmed || this.outcome) {
      return false;
    }
    this.resolveOutcome({ completed: false, launchApp: false });
    this.stopPendingWork();
    this.closeWindow();
    return true;
  }

  /**
   * Persists completion. The renderer's selections are re-applied here and the request is
   * rejected unless the flow really is on its final page.
   */
  public async complete(selections: SetupSelections): Promise<SetupCompletionResult> {
    this.requireActiveSession();
    if (!this.flow.getState().isFinalStep) {
      throw new Error('Setup cannot be completed before the final step.');
    }
    if (this.navigating) throw new Error('设置正在保存，请稍候。');
    this.checkSelectionChange(selections);
    this.navigating = true;
    try {
      this.flow.updateSelections(selections);
      const applied = this.flow.getSelections();
      if (setupResourceIds(applied).length)
        await this.requireResources().apply(applied, this.lifetime.signal);
      this.requireActiveSession();
      await this.options.store.markCompleted('wizard', this.options.now?.() ?? new Date());
      const result: SetupCompletionResult = {
        completed: true,
        launchApp: applied.launchAfterFinish,
      };
      this.resolveOutcome({ completed: true, launchApp: applied.launchAfterFinish });
      this.closeWindow();
      return result;
    } catch (error) {
      await this.options.store.recordFailure(this.flow.getState().stepId);
      throw error;
    } finally {
      this.navigating = false;
    }
  }

  public getResources(): Promise<SetupResourceStatus> {
    this.requireActiveSession();
    return this.requireResources().getStatus();
  }

  public async controlResources(input: SetupResourceControl): Promise<SetupViewState> {
    return this.navigate(async () => {
      if (this.flow.getState().stepId !== 'resources')
        throw new Error('请先在确认页确认所选资源。');
      if (input.action === 'skip') {
        await this.options.resources
          ?.control(this.flow.getSelections(), input, this.lifetime.signal)
          .catch(() => undefined);
      } else
        await this.requireResources().control(
          this.flow.getSelections(),
          input,
          this.lifetime.signal,
        );
      this.requireActiveSession();
      if (input.action === 'skip') {
        this.flow.updateSelections({ voice: 'none', speechInput: false });
        this.flow.restore('finish');
      }
    });
  }

  private requireResources(): SetupResourceService {
    if (!this.options.resources) throw new Error('资源服务暂不可用，请跳过本地语音。');
    return this.options.resources;
  }

  private checkSelectionChange(s: SetupSelections): void {
    const old = this.flow.getSelections();
    const step = this.flow.getState().stepId;
    if (
      (s.voice !== old.voice && step !== 'voice' && step !== 'mode') ||
      (s.speechInput !== old.speechInput && step !== 'speechInput' && step !== 'mode')
    ) {
      throw new Error('请返回对应页面修改语音选项。');
    }
  }

  private async navigate(operation: () => Promise<void>): Promise<SetupViewState> {
    this.requireActiveSession();
    if (this.navigating) throw new Error('设置正在保存，请稍候。');
    this.navigating = true;
    const previous = this.flow.getState();
    try {
      await operation();
      this.requireActiveSession();
      const state = this.flow.getState();
      await this.options.store.saveProgress({
        stepId: state.stepId,
        selections: state.selections,
        rerun: this.options.rerun ?? false,
      });
      this.requireActiveSession();
      return this.getViewState();
    } catch (error) {
      this.flow.updateSelections(previous.selections);
      this.flow.restore(previous.stepId);
      await this.options.store.recordFailure(previous.stepId);
      throw error;
    } finally {
      this.navigating = false;
    }
  }

  private stopPendingWork(): void {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    for (const requestId of this.providerTests)
      this.options.services?.cancelProviderTest(requestId);
    this.providerTests.clear();
    if (this.options.resources && setupResourceIds(this.flow.getSelections()).length) {
      void this.options.resources
        .control(
          this.flow.getSelections(),
          { action: 'pause', allowMetered: false },
          new AbortController().signal,
        )
        .catch(() => undefined);
    }
  }

  public getProviderStatus(): Promise<SetupProviderStatus> {
    this.requireActiveSession();
    return this.requireServices().getProviderStatus();
  }

  public applyProvider(input: ApplySetupProviderInput): Promise<ModelOperationResult> {
    this.requireActiveSession();
    return this.requireServices().applyProvider(input);
  }

  public async testProvider(
    input: TestProviderConnectionInput,
  ): Promise<TestProviderConnectionResult> {
    this.requireActiveSession();
    this.providerTests.add(input.requestId);
    try {
      return await this.requireServices().testProvider(input);
    } finally {
      this.providerTests.delete(input.requestId);
    }
  }

  public cancelProviderTest(requestId: string): boolean {
    this.requireActiveSession();
    return this.options.services?.cancelProviderTest(requestId) ?? false;
  }

  public getCharacterStatus(): Promise<SetupCharacterStatus> {
    this.requireActiveSession();
    return this.requireServices().getCharacterStatus();
  }

  public previewCharacterPackage(): Promise<CharacterPackageFileResult> {
    this.requireActiveSession();
    return this.requireServices().previewCharacterPackage();
  }

  public confirmCharacterPackage(
    input: ConfirmCharacterPackageImportInput,
  ): Promise<CharacterPackageFileResult> {
    this.requireActiveSession();
    return this.requireServices().confirmCharacterPackage(input);
  }

  public importLive2DModel(): Promise<Live2DModelImportResult> {
    this.requireActiveSession();
    return this.requireServices().importLive2DModel();
  }

  public dispose(): void {
    this.disposed = true;
    this.stopPendingWork();
    this.resolveOutcome({ completed: false, launchApp: false });
    this.closeWindow();
  }

  private requireServices(): SetupServices {
    if (!this.options.services) {
      throw new Error('The setup services are unavailable.');
    }
    return this.options.services;
  }

  /** Rejects work that arrives after the wizard was cancelled, finished or disposed. */
  private requireActiveSession(): void {
    if (this.disposed || this.outcome) {
      throw new Error('The setup session has already ended.');
    }
  }

  private closeWindow(): void {
    const window = this.getWindow();
    this.window = undefined;
    window?.destroy();
  }

  private resolveOutcome(outcome: SetupOutcome): void {
    if (this.outcome) {
      return;
    }
    this.outcome = outcome;
    this.settle?.(outcome);
    this.settle = undefined;
  }
}
