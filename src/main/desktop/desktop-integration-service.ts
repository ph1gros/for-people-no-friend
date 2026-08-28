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

const unsupportedMedia: MediaController = {
  getState: async () => ({ supported: false }),
  send: async () => false,
};

export class DesktopIntegrationService {
  private settings: DesktopIntegrationSettings = {
    globalShortcutsEnabled: false,
    mediaControlEnabled: false,
    visibilityShortcut: '\\',
  };
  private shortcutRegistered = false;
  private registeredVisibilityShortcut: string | undefined;
  private shortcutWindowFocused = false;
  private mediaCommandInFlight = false;

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

  public setShortcutWindowFocused(focused: boolean): void {
    if (this.shortcutWindowFocused === focused) return;
    this.shortcutWindowFocused = focused;
    this.applyShortcut();
  }

  public async sendMediaCommand(command: 'play-pause' | 'next' | 'previous'): Promise<boolean> {
    if (!this.settings.mediaControlEnabled || this.mediaCommandInFlight) return false;
    this.mediaCommandInFlight = true;
    try {
      return await this.media.send(command).catch(() => false);
    } finally {
      this.mediaCommandInFlight = false;
    }
  }

  public dispose(): void {
    this.unregisterVisibilityShortcut();
    this.shortcutRegistered = false;
  }

  private applyShortcut(): void {
    this.unregisterVisibilityShortcut();
    this.shortcutRegistered = false;
    if (this.settings.globalShortcutsEnabled && this.shortcutWindowFocused) {
      try {
        this.shortcutRegistered = this.shortcuts.register(
          this.settings.visibilityShortcut,
          this.toggleVisibility,
        );
        if (this.shortcutRegistered) {
          this.registeredVisibilityShortcut = this.settings.visibilityShortcut;
        }
      } catch {
        this.unregisterVisibilityShortcut();
        this.shortcutRegistered = false;
      }
    }
  }

  private unregisterVisibilityShortcut(): void {
    if (this.registeredVisibilityShortcut) {
      this.shortcuts.unregister(this.registeredVisibilityShortcut);
      this.registeredVisibilityShortcut = undefined;
    }
  }
}
