import type { DesktopIntegrationStatus } from '../../shared/desktop-integration-ipc';

export const WIDGET_STATE_PATHS = Object.freeze({
  'widget.enabled': (status: DesktopIntegrationStatus, id?: string) =>
    status.widgets?.find((widget) => widget.manifest.capability.id === id)?.enabled ?? false,
  'widget.available': (status: DesktopIntegrationStatus, id?: string) =>
    status.widgets?.find((widget) => widget.manifest.capability.id === id)?.available ?? false,
  'settings.inputOverlayEnabled': (status: DesktopIntegrationStatus) =>
    status.settings.inputOverlayEnabled,
  'settings.mediaControlEnabled': (status: DesktopIntegrationStatus) =>
    status.settings.mediaControlEnabled,
  'input.active': (status: DesktopIntegrationStatus) => status.inputOverlayActive,
  'media.supported': (status: DesktopIntegrationStatus) => status.media.supported,
});

export type WidgetStatePath = keyof typeof WIDGET_STATE_PATHS;

export interface DesktopWidgetCardBinding {
  enabledFrom: WidgetStatePath;
  activeFrom: WidgetStatePath;
  labels: { active: string; inactive: string; disabled: string };
}

export const validateWidgetCardBinding = (binding: DesktopWidgetCardBinding): void => {
  if (
    !binding ||
    !Object.hasOwn(WIDGET_STATE_PATHS, binding.enabledFrom) ||
    !Object.hasOwn(WIDGET_STATE_PATHS, binding.activeFrom) ||
    !binding.labels ||
    !['active', 'inactive', 'disabled'].every((key) => {
      const label = binding.labels[key as keyof typeof binding.labels];
      return typeof label === 'string' && label.trim().length > 0 && label.length <= 8;
    })
  )
    throw new Error('The desktop widget card binding is invalid.');
};
