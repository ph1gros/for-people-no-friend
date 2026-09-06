import type { DeskpetApi } from '../shared/ipc';
import type { DeskpetSetupApi } from '../shared/setup-ipc';

declare global {
  interface Window {
    deskpet?: DeskpetApi;
    deskpetSetup?: DeskpetSetupApi;
  }
}

export {};
