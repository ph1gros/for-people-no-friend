import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type DeskpetApi } from '../shared/ipc';

export type ResourceCenterApi = Pick<
  DeskpetApi,
  'getResourceCenterStatus' | 'refreshResourceCatalog' | 'controlSpeechAssetDownload'
>;

const api: ResourceCenterApi = {
  getResourceCenterStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getResourceCenterStatus),
  refreshResourceCatalog: () => ipcRenderer.invoke(IPC_CHANNELS.refreshResourceCatalog),
  controlSpeechAssetDownload: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.controlSpeechAssetDownload, input),
};
contextBridge.exposeInMainWorld('resourceCenterApi', api);
