import type { MediaController } from '../../core/desktop/integration';
import type {
  DesktopIntegrationSettings,
  DesktopIntegrationStatus,
} from '../../shared/desktop-integration-ipc';
import type { DesktopIntegrationStore } from '../storage/desktop-integration-store';

export interface GlobalShortcutAdapter {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

const TOGGLE_SHORTCUT = 'CommandOrControl+Shift+Space';

const unsupportedMedia: MediaController = {
  getState: async () => ({ supported: false }),
  send: async () => false,
};

export class DesktopIntegrationService {
  private settings: DesktopIntegrationSettings = {
    globalShortcutsEnabled: false,
    mediaControlEnabled: false,
  };
  private shortcutRegistered = false;

  public constructor(
    private readonly store: DesktopIntegrationStore,
    private readonly shortcuts: GlobalShortcutAdapter,
    private readonly toggleVisibility: () => void,
    private readonly media: MediaController = unsupportedMedia,
  ) {}

  public async initialize(): Promise<void> {
    this.settings = await this.store.get();
    this.applyShortcut();
  }

  public async getStatus(): Promise<DesktopIntegrationStatus> {
    return {
      settings: { ...this.settings },
      shortcutRegistered: this.shortcutRegistered,
      media: this.settings.mediaControlEnabled
        ? await this.media.getState().catch(() => ({ supported: false }))
        : { supported: false },
    };
  }

  public async setSettings(settings: DesktopIntegrationSettings): Promise<void> {
    await this.store.set(settings);
    this.settings = { ...settings };
    this.applyShortcut();
  }

  public async sendMediaCommand(command: 'play-pause' | 'next' | 'previous'): Promise<boolean> {
    return this.settings.mediaControlEnabled ? this.media.send(command).catch(() => false) : false;
  }

  public dispose(): void {
    if (this.shortcutRegistered) this.shortcuts.unregister(TOGGLE_SHORTCUT);
    this.shortcutRegistered = false;
  }

  private applyShortcut(): void {
    if (this.shortcutRegistered) {
      this.shortcuts.unregister(TOGGLE_SHORTCUT);
      this.shortcutRegistered = false;
    }
    if (this.settings.globalShortcutsEnabled) {
      this.shortcutRegistered = this.shortcuts.register(TOGGLE_SHORTCUT, this.toggleVisibility);
    }
  }
}
