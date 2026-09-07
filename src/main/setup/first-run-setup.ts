import { dialog, type BrowserWindow } from 'electron';

import {
  registerSetupIpcHandlers,
  type SetupIpcController,
} from '../ipc/register-setup-ipc-handlers';
import { SetupStateStore } from '../storage/setup-state-store';
import { createSetupWindow, waitForSetupWindowLoad } from '../windows/create-setup-window';

import { detectExistingInstallation, resolveSetupLaunchDecision } from './first-run-detection';
import { SetupController } from './setup-controller';
import type { SetupServices } from './setup-services';
import type { SetupResourceService } from './setup-resource-service';
import { DEFAULT_SETUP_SELECTIONS } from '../../shared/setup-ipc';

export interface FirstRunSetupDependencies {
  userDataPath: string;
  appVersion: string;
  /**
   * Builds the adapters over the services the application already created. The factory receives
   * a getter for the live setup window so file dialogs can be parented to it.
   */
  createServices?: (getWindow: () => BrowserWindow | undefined) => SetupServices;
  store?: SetupStateStore;
  hasExistingConfiguration?: () => Promise<boolean>;
  createWindow?: () => BrowserWindow;
  waitForWindowLoad?: (window: BrowserWindow) => Promise<void>;
  confirmCancel?: (window: BrowserWindow) => Promise<boolean>;
  registerHandlers?: (controller: SetupIpcController) => () => void;
  resources?: SetupResourceService;
  forceRerun?: boolean;
  onWindow?: (window: BrowserWindow) => void;
}

export interface FirstRunSetupResult {
  /** False only when the user cancelled setup or asked not to launch the application. */
  startApplication: boolean;
  ranWizard: boolean;
  adoptedExistingInstallation: boolean;
}

const confirmSetupCancellation = async (window: BrowserWindow): Promise<boolean> => {
  const { response } = await dialog.showMessageBox(window, {
    type: 'question',
    buttons: ['继续设置', '退出安装'],
    defaultId: 0,
    cancelId: 0,
    title: '取消设置',
    message: '要取消首次设置吗？',
    detail: '已保存的配置会保留，资源下载会暂停。下次打开向导将从已保存步骤继续。',
    noLink: true,
  });
  return response === 1;
};

/**
 * Decides whether the wizard runs before the deskpet window, and runs it when needed.
 *
 * An installation that already has usable configuration is marked as complete instead of being
 * pushed through setup, and a wizard that fails to open never blocks the application.
 */
export const runFirstRunSetupIfNeeded = async (
  dependencies: FirstRunSetupDependencies,
): Promise<FirstRunSetupResult> => {
  const store = dependencies.store ?? new SetupStateStore(dependencies.userDataPath);
  const state = await store.get();
  const hasExistingConfiguration = state.completed
    ? false
    : await (dependencies.hasExistingConfiguration?.() ??
        detectExistingInstallation(dependencies.userDataPath));
  const decision = dependencies.forceRerun
    ? { runSetup: true, adoptExistingInstallation: false }
    : resolveSetupLaunchDecision({ state, hasExistingConfiguration });

  if (decision.adoptExistingInstallation) {
    try {
      await store.markCompleted('existing-installation');
    } catch {
      console.warn('Unable to record the existing installation setup state.');
    }
    return { startApplication: true, ranWizard: false, adoptedExistingInstallation: true };
  }

  if (!decision.runSetup) {
    return { startApplication: true, ranWizard: false, adoptedExistingInstallation: false };
  }

  const progress = state.progress ?? {
    stepId: 'welcome' as const,
    selections: { ...DEFAULT_SETUP_SELECTIONS },
    rerun: dependencies.forceRerun ?? false,
  };
  await store.saveProgress(progress);

  // The services need the live window for file dialogs, and the controller needs the services,
  // so the window is reached through a reference that is filled in once the controller exists.
  const active: { controller?: SetupController<BrowserWindow> } = {};
  const services = dependencies.createServices?.(() => active.controller?.getWindow());
  const controller = new SetupController<BrowserWindow>({
    store,
    appVersion: dependencies.appVersion,
    createWindow: dependencies.createWindow ?? (() => createSetupWindow()),
    confirmCancel: dependencies.confirmCancel ?? confirmSetupCancellation,
    ...(services ? { services } : {}),
    ...(dependencies.resources ? { resources: dependencies.resources } : {}),
    progress,
    rerun: progress.rerun,
  });
  active.controller = controller;
  const unregister = (dependencies.registerHandlers ?? registerSetupIpcHandlers)(controller);

  let openedWindow: BrowserWindow | undefined;
  try {
    const window = controller.open();
    openedWindow = window;
    dependencies.onWindow?.(window);
    await (dependencies.waitForWindowLoad ?? waitForSetupWindowLoad)(window);
  } catch {
    // Closing the window while it loads is still a cancellation, not a startup failure.
    const canceled = openedWindow?.isDestroyed() ?? false;
    if (!canceled)
      console.warn('Unable to open the setup wizard. Starting the application instead.');
    unregister();
    controller.dispose();
    return {
      startApplication: !canceled,
      ranWizard: canceled,
      adoptedExistingInstallation: false,
    };
  }

  try {
    const outcome = await controller.waitForOutcome();
    return {
      startApplication: outcome.completed && outcome.launchApp,
      ranWizard: true,
      adoptedExistingInstallation: false,
    };
  } finally {
    unregister();
    controller.dispose();
  }
};
