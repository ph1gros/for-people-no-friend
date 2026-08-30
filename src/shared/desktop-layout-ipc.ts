export const CHARACTER_PANES = ['left', 'right'] as const;
export const WIDGET_ALIGNMENTS = ['start', 'center', 'end'] as const;

export type CharacterPane = (typeof CHARACTER_PANES)[number];
export type WidgetAlignment = (typeof WIDGET_ALIGNMENTS)[number];

export interface DesktopLayoutSettings {
  characterPane: CharacterPane;
  widgetAlignment: WidgetAlignment;
}

export interface SetDesktopLayoutSettingsInput {
  settings: DesktopLayoutSettings;
}

export const DEFAULT_DESKTOP_LAYOUT_SETTINGS: DesktopLayoutSettings = Object.freeze({
  characterPane: 'left',
  widgetAlignment: 'start',
});

const CHARACTER_PANE_SET = new Set<string>(CHARACTER_PANES);
const WIDGET_ALIGNMENT_SET = new Set<string>(WIDGET_ALIGNMENTS);

export const parseDesktopLayoutSettings = (value: unknown): DesktopLayoutSettings => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The desktop layout settings are invalid.');
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.characterPane !== 'string' ||
    !CHARACTER_PANE_SET.has(candidate.characterPane) ||
    typeof candidate.widgetAlignment !== 'string' ||
    !WIDGET_ALIGNMENT_SET.has(candidate.widgetAlignment)
  ) {
    throw new Error('The desktop layout settings are invalid.');
  }
  return {
    characterPane: candidate.characterPane as CharacterPane,
    widgetAlignment: candidate.widgetAlignment as WidgetAlignment,
  };
};

export const parseSetDesktopLayoutSettingsInput = (
  value: unknown,
): SetDesktopLayoutSettingsInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('settings' in value)) {
    throw new Error('The desktop layout input is invalid.');
  }
  return { settings: parseDesktopLayoutSettings(value.settings) };
};
