import {
  validateExtensionCapabilityManifest,
  type ExtensionCapabilityManifest,
} from '../../core/desktop/integration';
import {
  DESKTOP_WIDGET_IDS,
  type DesktopIntegrationStatus,
  type DesktopWidgetId,
} from '../../shared/desktop-integration-ipc';

export interface DesktopWidgetCardState {
  enabled: boolean;
  active: boolean;
  label: string;
}

export interface DesktopWidgetDefinition {
  capability: ExtensionCapabilityManifest;
  id: DesktopWidgetId;
  title: string;
  description: string;
  iconText: string;
  settingsView: DesktopWidgetId;
  getCardState(status: DesktopIntegrationStatus): DesktopWidgetCardState;
}

export class DesktopWidgetRegistry {
  private readonly definitions = new Map<DesktopWidgetId, DesktopWidgetDefinition>();

  public register(definition: DesktopWidgetDefinition): void {
    const capability = validateExtensionCapabilityManifest(definition.capability);
    if (
      capability.kind !== 'widget' ||
      capability.id !== definition.id ||
      !DESKTOP_WIDGET_IDS.includes(definition.id) ||
      definition.settingsView !== definition.id ||
      definition.title.trim().length < 1 ||
      definition.title.length > 32 ||
      definition.description.trim().length < 1 ||
      definition.description.length > 120 ||
      definition.iconText.length < 1 ||
      definition.iconText.length > 4 ||
      this.definitions.has(definition.id)
    ) {
      throw new Error('The desktop widget definition is invalid.');
    }
    this.definitions.set(definition.id, Object.freeze({ ...definition, capability }));
  }

  public list(): DesktopWidgetDefinition[] {
    return [...this.definitions.values()];
  }
}

export const desktopWidgetRegistry = new DesktopWidgetRegistry();

desktopWidgetRegistry.register({
  capability: {
    version: 1,
    id: 'input',
    kind: 'widget',
    permissions: ['input-activity'],
    timeoutMs: 2_000,
  },
  id: 'input',
  title: '输入显示',
  description: '显示自选按键、鼠标按键和移动方向',
  iconText: '⌨',
  settingsView: 'input',
  getCardState: (status) => ({
    enabled: status.settings.inputOverlayEnabled,
    active: status.inputOverlayActive,
    label: status.settings.inputOverlayEnabled
      ? status.inputOverlayActive
        ? '运行中'
        : '启动失败'
      : '已关闭',
  }),
});

desktopWidgetRegistry.register({
  capability: {
    version: 1,
    id: 'media',
    kind: 'widget',
    permissions: ['media-control'],
    timeoutMs: 6_000,
  },
  id: 'media',
  title: '听歌控制',
  description: '显示当前曲目并控制上一首、播放和下一首',
  iconText: '♫',
  settingsView: 'media',
  getCardState: (status) => ({
    enabled: status.settings.mediaControlEnabled,
    active: status.settings.mediaControlEnabled && status.media.supported,
    label: status.settings.mediaControlEnabled
      ? status.media.supported
        ? '已开启'
        : '不可用'
      : '已关闭',
  }),
});
