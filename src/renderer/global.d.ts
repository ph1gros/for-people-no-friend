import type { DeskpetApi } from '../shared/ipc';

declare global {
  interface Window {
    deskpet?: DeskpetApi;
  }
}

export {};
