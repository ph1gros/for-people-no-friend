import type { DesktopAction, MediaController } from '../../core/desktop/integration';
import type {
  DesktopInputActivityEvent,
  DesktopIntegrationSettings,
  DesktopIntegrationStatus,
  DesktopWidgetId,
} from '../../shared/desktop-integration-ipc';
import type { DesktopIntegrationStore } from '../storage/desktop-integration-store';

export interface GlobalShortcutAdapter {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface InputActivityMonitorAdapter {
  start(
    settings: Pick<DesktopIntegrationSettings, 'inputOverlayKeys' | 'inputOverlayMouseEnabled'>,
    emit: (event: DesktopInputActivityEvent) => void,
  ): Promise<boolean>;
  stop(): void;
}

const unsupportedMedia: MediaController = {
  getState: async () => ({ supported: false }),
  send: async () => false,
};

const unsupportedInputActivity: InputActivityMonitorAdapter = {
  start: async () => false,
  stop: () => undefined,
};

export class DesktopIntegrationService {
  private settings: DesktopIntegrationSettings = {
    globalShortcutsEnabled: false,
    mediaControlEnabled: false,
    inputOverlayEnabled: false,
    inputOverlayMouseEnabled: true,
    inputOverlayKeys: ['W', 'A', 'S', 'D'],
    widgetOrder: [],
    visibilityShortcut: '\\',
    stopGenerationShortcut: 'Ctrl+Shift+Delete',
  };
  private shortcutRegistered = false;
  private stopGenerationShortcutRegistered = false;
  private readonly registeredShortcuts = new Set<string>();
  private shortcutWindowFocused = false;
  private mediaCommandInFlight = false;
  private inputOverlayActive = false;

  public constructor(
    private readonly store: DesktopIntegrationStore,
    private readonly shortcuts: GlobalShortcutAdapter,
    private readonly toggleVisibility: () => void,
    private readonly media: MediaController = unsupportedMedia,
    private readonly stopGeneration: () => void = () => undefined,
    private readonly inputActivity: InputActivityMonitorAdapter = unsupportedInputActivity,
    private readonly emitInputActivity: (event: DesktopInputActivityEvent) => void = () =>
      undefined,
  ) {}

  public async initialize(): Promise<void> {
    this.settings = await this.store.get();
    this.applyShortcut();
    await this.applyInputOverlay();
  }

  public async getStatus(): Promise<DesktopIntegrationStatus> {
    return {
      settings: { ...this.settings },
      shortcutRegistered: this.shortcutRegistered,
      stopGenerationShortcutRegistered: this.stopGenerationShortcutRegistered,
      inputOverlayActive: this.inputOverlayActive,
      media: this.settings.mediaControlEnabled
        ? await this.media.getState().catch(() => ({ supported: false }))
        : { supported: false },
    };
  }

  public async setSettings(settings: DesktopIntegrationSettings): Promise<void> {
    await this.store.set(settings);
    this.settings = { ...settings };
    this.applyShortcut();
    await this.applyInputOverlay();
  }

  public async setWidgetEnabled(widgetId: DesktopWidgetId, enabled: boolean): Promise<void> {
    const widgetOrder = this.settings.widgetOrder.filter((widget) => widget !== widgetId);
    if (enabled) widgetOrder.push(widgetId);
    const settings = { ...this.settings, widgetOrder };
    switch (widgetId) {
      case 'input':
        settings.inputOverlayEnabled = enabled;
        break;
      case 'media':
        settings.mediaControlEnabled = enabled;
        break;
      default:
        throw new Error('The desktop widget extension is not registered.');
    }
    await this.setSettings(settings);
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

  public async triggerAction(action: DesktopAction): Promise<boolean> {
    switch (action) {
      case 'toggle-visibility':
        this.toggleVisibility();
        return true;
      case 'stop-generation':
        this.stopGeneration();
        return true;
      case 'media-play-pause':
        return this.sendMediaCommand('play-pause');
      case 'media-next':
        return this.sendMediaCommand('next');
      case 'media-previous':
        return this.sendMediaCommand('previous');
      default:
        return false;
    }
  }

  public dispose(): void {
    this.unregisterShortcuts();
    this.inputActivity.stop();
    this.shortcutRegistered = false;
    this.stopGenerationShortcutRegistered = false;
    this.inputOverlayActive = false;
  }

  private applyShortcut(): void {
    this.unregisterShortcuts();
    this.shortcutRegistered = false;
    this.stopGenerationShortcutRegistered = false;
    if (this.settings.globalShortcutsEnabled && this.shortcutWindowFocused) {
      this.shortcutRegistered = this.registerShortcut(
        this.settings.visibilityShortcut,
        () => void this.triggerAction('toggle-visibility'),
      );
      this.stopGenerationShortcutRegistered = this.registerShortcut(
        this.settings.stopGenerationShortcut,
        () => void this.triggerAction('stop-generation'),
      );
    }
  }

  private registerShortcut(accelerator: string, action: () => void): boolean {
    try {
      const registered = this.shortcuts.register(accelerator, action);
      if (registered) this.registeredShortcuts.add(accelerator);
      return registered;
    } catch {
      return false;
    }
  }

  private unregisterShortcuts(): void {
    for (const accelerator of this.registeredShortcuts) {
      this.shortcuts.unregister(accelerator);
    }
    this.registeredShortcuts.clear();
  }

  private async applyInputOverlay(): Promise<void> {
    this.inputActivity.stop();
    this.inputOverlayActive = false;
    if (!this.settings.inputOverlayEnabled) return;
    this.inputOverlayActive = await this.inputActivity
      .start(this.settings, this.emitInputActivity)
      .catch(() => false);
  }
}
