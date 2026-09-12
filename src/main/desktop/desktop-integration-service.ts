import type {
  DesktopAction,
  MediaController,
  MediaSessionState,
} from '../../core/desktop/integration';
import type {
  DesktopInputActivityEvent,
  DesktopIntegrationSettings,
  DesktopIntegrationStatus,
  DesktopWidgetId,
  InputOverlayKey,
} from '../../shared/desktop-integration-ipc';
import type { DesktopIntegrationStore } from '../storage/desktop-integration-store';
import type { SafeDiagnosticSink } from '../diagnostics/safe-diagnostic-log';
import {
  parseDesktopIntegrationSettings,
  parseDesktopInputActivityEvent,
} from '../../shared/desktop-integration-ipc';
import { WidgetRuntime } from '../widgets/widget-runtime';

export interface GlobalShortcutAdapter {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface InputActivityMonitorAdapter {
  start(
    settings: {
      inputOverlayKeys: InputOverlayKey[];
      inputOverlayMouseEnabled: boolean;
    },
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
  private pushToTalkKey: InputOverlayKey | undefined;
  private readonly activeKeys = new Set<string>();
  private readonly activeMouseButtons = new Set<string>();
  private mouseDirection: string | null = null;
  private mediaRead: { at: number; result: Promise<MediaSessionState> } | undefined;

  private readMedia(): Promise<MediaSessionState> {
    const now = Date.now();
    if (!this.mediaRead || now - this.mediaRead.at >= 5000 || now < this.mediaRead.at) {
      this.mediaRead = {
        at: now,
        result: this.media.getState().catch(() => ({ supported: false })),
      };
    }
    return this.mediaRead.result;
  }

  public constructor(
    private readonly store: DesktopIntegrationStore,
    private readonly shortcuts: GlobalShortcutAdapter,
    private readonly toggleVisibility: () => void,
    private readonly media: MediaController = unsupportedMedia,
    private readonly stopGeneration: () => void = () => undefined,
    private readonly inputActivity: InputActivityMonitorAdapter = unsupportedInputActivity,
    private readonly emitInputActivity: (event: DesktopInputActivityEvent) => void = () =>
      undefined,
    private readonly diagnostics?: SafeDiagnosticSink,
    private readonly widgets = new WidgetRuntime(),
  ) {}

  public async initialize(): Promise<void> {
    try {
      this.settings = await this.store.get();
      this.applyShortcut();
      await this.applyInputOverlay();
    } catch {
      this.diagnostics?.('desktop-integration-start-failed');
    }
  }

  public async getStatus(): Promise<DesktopIntegrationStatus> {
    const status: DesktopIntegrationStatus = {
      settings: { ...this.settings },
      shortcutRegistered: this.shortcutRegistered,
      stopGenerationShortcutRegistered: this.stopGenerationShortcutRegistered,
      inputOverlayActive: this.inputOverlayActive,
      media: this.settings.mediaControlEnabled ? await this.readMedia() : { supported: false },
    };
    status.widgets = this.widgets.snapshots(status.settings.declarativeWidgetIds ?? [], {
      media: status.settings.mediaControlEnabled ? status.media : undefined,
      input:
        status.settings.inputOverlayEnabled && status.inputOverlayActive
          ? {
              keys: [...this.activeKeys],
              mouse: [...this.activeMouseButtons],
              direction: this.mouseDirection,
            }
          : undefined,
    });
    status.widgetPackageErrors = this.widgets.getErrors();
    return status;
  }

  public getWidgetIds(): string[] {
    return this.widgets.knownIds();
  }

  public async setSettings(settings: DesktopIntegrationSettings): Promise<void> {
    settings = parseDesktopIntegrationSettings(settings, this.getWidgetIds());
    await this.store.set(settings);
    this.settings = { ...settings };
    this.mediaRead = undefined;
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
        if (!this.widgets.has(widgetId))
          throw new Error('The desktop widget extension is not registered.');
        settings.declarativeWidgetIds = (settings.declarativeWidgetIds ?? []).filter(
          (id) => id !== widgetId,
        );
        if (enabled) settings.declarativeWidgetIds.push(widgetId);
    }
    await this.setSettings(settings);
  }

  public async setPushToTalkKey(key: InputOverlayKey | undefined): Promise<void> {
    if (this.pushToTalkKey === key) return;
    this.pushToTalkKey = key;
    await this.applyInputOverlay();
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
      this.mediaRead = undefined;
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
    this.activeKeys.clear();
    this.activeMouseButtons.clear();
    this.mouseDirection = null;
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
      this.diagnostics?.('desktop-integration-configuration-failed');
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
    this.activeKeys.clear();
    this.activeMouseButtons.clear();
    this.mouseDirection = null;
    this.inputOverlayActive = false;
    if (!this.settings.inputOverlayEnabled && !this.pushToTalkKey) return;
    const inputOverlayKeys = [
      ...new Set([
        ...this.settings.inputOverlayKeys,
        ...(this.pushToTalkKey ? [this.pushToTalkKey] : []),
      ]),
    ];
    const monitorActive = await this.inputActivity
      .start(
        {
          inputOverlayKeys,
          inputOverlayMouseEnabled:
            this.settings.inputOverlayEnabled && this.settings.inputOverlayMouseEnabled,
        },
        (rawEvent) => {
          const event = parseDesktopInputActivityEvent(rawEvent);
          if (this.settings.inputOverlayEnabled) {
            if (event.type === 'key' && this.settings.inputOverlayKeys.includes(event.key)) {
              if (event.pressed) this.activeKeys.add(event.key);
              else this.activeKeys.delete(event.key);
            } else if (event.type === 'mouse-button' && this.settings.inputOverlayMouseEnabled) {
              if (event.pressed) this.activeMouseButtons.add(event.button);
              else this.activeMouseButtons.delete(event.button);
            } else if (event.type === 'mouse-direction' && this.settings.inputOverlayMouseEnabled)
              this.mouseDirection = event.direction;
          }
          this.emitInputActivity(event);
        },
      )
      .catch(() => {
        this.diagnostics?.('desktop-integration-configuration-failed');
        return false;
      });
    this.inputOverlayActive = this.settings.inputOverlayEnabled && monitorActive;
  }
}
