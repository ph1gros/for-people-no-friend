export const MIN_WINDOW_SCALE = 0.65;
export const MAX_WINDOW_SCALE = 1.5;

export interface SetWindowScaleInput {
  scale: number;
}

export interface SetChatPanelExpandedInput {
  expanded: boolean;
}

export const parseSetWindowScaleInput = (value: unknown): SetWindowScaleInput => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('scale' in value) ||
    typeof value.scale !== 'number' ||
    !Number.isFinite(value.scale) ||
    value.scale < MIN_WINDOW_SCALE ||
    value.scale > MAX_WINDOW_SCALE
  ) {
    throw new Error('The window scale is invalid.');
  }
  return { scale: value.scale };
};

export const parseSetChatPanelExpandedInput = (value: unknown): SetChatPanelExpandedInput => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('expanded' in value) ||
    typeof value.expanded !== 'boolean'
  ) {
    throw new Error('The chat panel state is invalid.');
  }
  return { expanded: value.expanded };
};
