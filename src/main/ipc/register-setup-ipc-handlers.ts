import { ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc';
import {
  parseSetupResourceControl,
  type SetupResourceControl,
  type SetupResourceStatus,
} from '../../shared/setup-resources';
import {
  parseAdvanceSetupInput,
  parseApplySetupProviderInput,
  parseCompleteSetupInput,
  type ApplySetupProviderInput,
  type SetupCharacterStatus,
  type SetupCompletionResult,
  type SetupProviderStatus,
  type SetupViewState,
} from '../../shared/setup-ipc';
import {
  parseConfirmCharacterPackageImportInput,
  type CharacterPackageFileResult,
  type ConfirmCharacterPackageImportInput,
} from '../../shared/character-package-ipc';
import type { Live2DModelImportResult } from '../../shared/live2d-model-ipc';
import {
  parseCancelProviderRequestInput,
  parseTestProviderConnectionInput,
  type ModelOperationResult,
  type TestProviderConnectionInput,
  type TestProviderConnectionResult,
} from '../../shared/model-ipc';
import type { SetupSelections } from '../../core/setup/setup-flow';

import { isTrustedIpcSender, type SenderValidationWindow } from './sender-validation';

export interface SetupIpcController {
  getWindow(): SenderValidationWindow | undefined;
  getViewState(): SetupViewState;
  advance(selections: SetupSelections): SetupViewState | Promise<SetupViewState>;
  back(): SetupViewState | Promise<SetupViewState>;
  getResources(): Promise<SetupResourceStatus>;
  controlResources(input: SetupResourceControl): Promise<SetupViewState>;
  cancel(): Promise<boolean>;
  complete(selections: SetupSelections): Promise<SetupCompletionResult>;
  getProviderStatus(): Promise<SetupProviderStatus>;
  applyProvider(input: ApplySetupProviderInput): Promise<ModelOperationResult>;
  testProvider(input: TestProviderConnectionInput): Promise<TestProviderConnectionResult>;
  cancelProviderTest(requestId: string): boolean;
  getCharacterStatus(): Promise<SetupCharacterStatus>;
  previewCharacterPackage(): Promise<CharacterPackageFileResult>;
  confirmCharacterPackage(
    input: ConfirmCharacterPackageImportInput,
  ): Promise<CharacterPackageFileResult>;
  importLive2DModel(): Promise<Live2DModelImportResult>;
}

export const SETUP_IPC_CHANNELS = Object.freeze([
  IPC_CHANNELS.getSetupState,
  IPC_CHANNELS.getSetupResources,
  IPC_CHANNELS.controlSetupResources,
  IPC_CHANNELS.advanceSetup,
  IPC_CHANNELS.goBackInSetup,
  IPC_CHANNELS.cancelSetup,
  IPC_CHANNELS.completeSetup,
  IPC_CHANNELS.getSetupProviderStatus,
  IPC_CHANNELS.applySetupProvider,
  IPC_CHANNELS.testSetupProvider,
  IPC_CHANNELS.cancelSetupProviderTest,
  IPC_CHANNELS.getSetupCharacterStatus,
  IPC_CHANNELS.previewSetupCharacterPackage,
  IPC_CHANNELS.confirmSetupCharacterPackage,
  IPC_CHANNELS.importSetupLive2DModel,
]);

/**
 * Registers the wizard channels and returns a disposer. Only the live setup window may call
 * them, so the deskpet renderer can never drive or complete setup.
 */
export const registerSetupIpcHandlers = (controller: SetupIpcController): (() => void) => {
  const requireTrustedSender = (event: Parameters<typeof isTrustedIpcSender>[0]): void => {
    if (!isTrustedIpcSender(event, controller.getWindow())) {
      throw new Error('Unauthorized IPC sender.');
    }
  };

  ipcMain.handle(IPC_CHANNELS.getSetupState, (event) => {
    requireTrustedSender(event);
    return controller.getViewState();
  });
  ipcMain.handle(IPC_CHANNELS.getSetupResources, (event) => {
    requireTrustedSender(event);
    return controller.getResources();
  });
  ipcMain.handle(IPC_CHANNELS.controlSetupResources, (event, input: unknown) => {
    requireTrustedSender(event);
    return controller.controlResources(parseSetupResourceControl(input));
  });

  ipcMain.handle(IPC_CHANNELS.advanceSetup, (event, input: unknown) => {
    requireTrustedSender(event);
    return controller.advance(parseAdvanceSetupInput(input).selections);
  });

  ipcMain.handle(IPC_CHANNELS.goBackInSetup, (event) => {
    requireTrustedSender(event);
    return controller.back();
  });

  ipcMain.handle(IPC_CHANNELS.cancelSetup, (event) => {
    requireTrustedSender(event);
    return controller.cancel();
  });

  ipcMain.handle(IPC_CHANNELS.completeSetup, (event, input: unknown) => {
    requireTrustedSender(event);
    return controller.complete(parseCompleteSetupInput(input).selections);
  });

  ipcMain.handle(IPC_CHANNELS.getSetupProviderStatus, (event) => {
    requireTrustedSender(event);
    return controller.getProviderStatus();
  });

  ipcMain.handle(IPC_CHANNELS.applySetupProvider, (event, input: unknown) => {
    requireTrustedSender(event);
    return controller.applyProvider(parseApplySetupProviderInput(input));
  });

  ipcMain.handle(IPC_CHANNELS.testSetupProvider, (event, input: unknown) => {
    requireTrustedSender(event);
    return controller.testProvider(parseTestProviderConnectionInput(input));
  });

  ipcMain.handle(IPC_CHANNELS.cancelSetupProviderTest, (event, input: unknown) => {
    requireTrustedSender(event);
    return controller.cancelProviderTest(parseCancelProviderRequestInput(input).requestId);
  });

  ipcMain.handle(IPC_CHANNELS.getSetupCharacterStatus, (event) => {
    requireTrustedSender(event);
    return controller.getCharacterStatus();
  });

  ipcMain.handle(IPC_CHANNELS.previewSetupCharacterPackage, (event) => {
    requireTrustedSender(event);
    return controller.previewCharacterPackage();
  });

  ipcMain.handle(IPC_CHANNELS.confirmSetupCharacterPackage, (event, input: unknown) => {
    requireTrustedSender(event);
    return controller.confirmCharacterPackage(parseConfirmCharacterPackageImportInput(input));
  });

  ipcMain.handle(IPC_CHANNELS.importSetupLive2DModel, (event) => {
    requireTrustedSender(event);
    return controller.importLive2DModel();
  });

  return () => {
    for (const channel of SETUP_IPC_CHANNELS) {
      ipcMain.removeHandler(channel);
    }
  };
};
