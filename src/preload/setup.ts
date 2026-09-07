import { contextBridge, ipcRenderer } from 'electron';

import type { ConfirmCharacterPackageImportInput } from '../shared/character-package-ipc';
import { IPC_CHANNELS } from '../shared/ipc';
import type { SetupResourceControl } from '../shared/setup-resources';
import type { TestProviderConnectionInput } from '../shared/model-ipc';
import type {
  AdvanceSetupInput,
  ApplySetupProviderInput,
  CompleteSetupInput,
  DeskpetSetupApi,
  PreviewSetupVoiceInput,
} from '../shared/setup-ipc';

/**
 * The setup window receives only the wizard channels. It never sees stored secrets, the
 * filesystem, the conversation surface or any other deskpet capability.
 */
const deskpetSetupApi: DeskpetSetupApi = Object.freeze({
  getSetupResources: () => ipcRenderer.invoke(IPC_CHANNELS.getSetupResources),
  controlSetupResources: (input: SetupResourceControl) =>
    ipcRenderer.invoke(IPC_CHANNELS.controlSetupResources, input),
  getSetupState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getSetupState) as ReturnType<DeskpetSetupApi['getSetupState']>,
  advanceSetup: (input: AdvanceSetupInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.advanceSetup, input) as ReturnType<
      DeskpetSetupApi['advanceSetup']
    >,
  goBackInSetup: () =>
    ipcRenderer.invoke(IPC_CHANNELS.goBackInSetup) as ReturnType<DeskpetSetupApi['goBackInSetup']>,
  cancelSetup: () =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelSetup) as ReturnType<DeskpetSetupApi['cancelSetup']>,
  completeSetup: (input: CompleteSetupInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.completeSetup, input) as ReturnType<
      DeskpetSetupApi['completeSetup']
    >,
  getSetupProviderStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getSetupProviderStatus) as ReturnType<
      DeskpetSetupApi['getSetupProviderStatus']
    >,
  applySetupProvider: (input: ApplySetupProviderInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.applySetupProvider, input) as ReturnType<
      DeskpetSetupApi['applySetupProvider']
    >,
  testSetupProvider: (input: TestProviderConnectionInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.testSetupProvider, input) as ReturnType<
      DeskpetSetupApi['testSetupProvider']
    >,
  cancelSetupProviderTest: (input: { requestId: string }) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelSetupProviderTest, input) as ReturnType<
      DeskpetSetupApi['cancelSetupProviderTest']
    >,
  getSetupCharacterStatus: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getSetupCharacterStatus) as ReturnType<
      DeskpetSetupApi['getSetupCharacterStatus']
    >,
  previewSetupCharacterPackage: () =>
    ipcRenderer.invoke(IPC_CHANNELS.previewSetupCharacterPackage) as ReturnType<
      DeskpetSetupApi['previewSetupCharacterPackage']
    >,
  confirmSetupCharacterPackage: (input: ConfirmCharacterPackageImportInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.confirmSetupCharacterPackage, input) as ReturnType<
      DeskpetSetupApi['confirmSetupCharacterPackage']
    >,
  importSetupLive2DModel: () =>
    ipcRenderer.invoke(IPC_CHANNELS.importSetupLive2DModel) as ReturnType<
      DeskpetSetupApi['importSetupLive2DModel']
    >,
  previewSetupVoice: (input: PreviewSetupVoiceInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.previewSetupVoice, input) as ReturnType<
      DeskpetSetupApi['previewSetupVoice']
    >,
  stopSetupVoicePreview: () =>
    ipcRenderer.invoke(IPC_CHANNELS.stopSetupVoicePreview) as ReturnType<
      DeskpetSetupApi['stopSetupVoicePreview']
    >,
});

contextBridge.exposeInMainWorld('deskpetSetup', deskpetSetupApi);
