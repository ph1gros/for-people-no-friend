export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenArea extends ScreenPoint {
  width: number;
  height: number;
}

const clamp = (value: number): number => Math.min(1, Math.max(-1, value));

export const cursorProximityToArea = (
  cursor: ScreenPoint,
  area: ScreenArea,
  nearbyDistance = 48,
): number => {
  const distanceX = Math.max(area.x - cursor.x, 0, cursor.x - (area.x + area.width));
  const distanceY = Math.max(area.y - cursor.y, 0, cursor.y - (area.y + area.height));
  const distance = Math.hypot(distanceX, distanceY);
  return Math.max(0, Math.min(1, 1 - distance / Math.max(1, nearbyDistance)));
};

export const normalizeCursorToWorkArea = (
  cursor: ScreenPoint,
  workArea: ScreenArea,
): ScreenPoint => ({
  x: clamp(((cursor.x - workArea.x) / Math.max(1, workArea.width)) * 2 - 1),
  y: clamp(1 - ((cursor.y - workArea.y) / Math.max(1, workArea.height)) * 2),
});
