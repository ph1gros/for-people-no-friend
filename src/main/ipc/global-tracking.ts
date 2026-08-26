export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenArea extends ScreenPoint {
  width: number;
  height: number;
}

const clamp = (value: number): number => Math.min(1, Math.max(-1, value));

export const normalizeCursorToWorkArea = (
  cursor: ScreenPoint,
  workArea: ScreenArea,
): ScreenPoint => ({
  x: clamp(((cursor.x - workArea.x) / Math.max(1, workArea.width)) * 2 - 1),
  y: clamp(1 - ((cursor.y - workArea.y) / Math.max(1, workArea.height)) * 2),
});
