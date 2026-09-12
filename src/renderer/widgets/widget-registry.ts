import {
  validateExtensionCapabilityManifest,
  type ExtensionCapabilityManifest,
} from '../../core/desktop/integration';
import {
  type DesktopIntegrationStatus,
  type DesktopWidgetId,
} from '../../shared/desktop-integration-ipc';
import { isWidgetId, MAX_DESKTOP_WIDGETS } from '../../shared/widget-contract';
import {
  WIDGET_STATE_PATHS,
  validateWidgetCardBinding,
  type DesktopWidgetCardBinding,
} from './widget-state-paths';

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
  cardState: DesktopWidgetCardBinding;
}

export const resolveWidgetCardState = (
  definition: DesktopWidgetDefinition,
  status: DesktopIntegrationStatus,
): DesktopWidgetCardState => {
  const binding = definition.cardState;
  const enabled = WIDGET_STATE_PATHS[binding.enabledFrom](status, definition.id);
  // Main clears inputOverlayActive on stop and gates every start result by inputOverlayEnabled.
  const active = enabled && WIDGET_STATE_PATHS[binding.activeFrom](status, definition.id);
  return {
    enabled,
    active,
    label: !enabled
      ? binding.labels.disabled
      : active
        ? binding.labels.active
        : binding.labels.inactive,
  };
};

export class DesktopWidgetRegistry {
  private readonly definitions = new Map<DesktopWidgetId, DesktopWidgetDefinition>();

  public register(definition: DesktopWidgetDefinition): void {
    const capability = validateExtensionCapabilityManifest(definition.capability);
    validateWidgetCardBinding(definition.cardState);
    if (
      capability.kind !== 'widget' ||
      capability.id !== definition.id ||
      !isWidgetId(definition.id) ||
      this.definitions.size >= MAX_DESKTOP_WIDGETS ||
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
    this.definitions.set(
      definition.id,
      Object.freeze({
        ...definition,
        capability,
        cardState: Object.freeze({
          ...definition.cardState,
          labels: Object.freeze({ ...definition.cardState.labels }),
        }),
      }),
    );
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
  cardState: {
    enabledFrom: 'settings.inputOverlayEnabled',
    activeFrom: 'input.active',
    labels: { active: '运行中', inactive: '启动失败', disabled: '已关闭' },
  },
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
  cardState: {
    enabledFrom: 'settings.mediaControlEnabled',
    activeFrom: 'media.supported',
    labels: { active: '已开启', inactive: '不可用', disabled: '已关闭' },
  },
});
