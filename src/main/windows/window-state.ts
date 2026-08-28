import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Rectangle } from 'electron';
import { MAX_WINDOW_SCALE, MIN_WINDOW_SCALE } from '../../shared/window-ipc';
export const DEFAULT_WINDOW_SIZE = Object.freeze({ width: 360, height: 520 });
export const EXPANDED_WINDOW_SIZE = Object.freeze({ width: 720, height: 520 });
export const SETTINGS_WINDOW_SIZE = EXPANDED_WINDOW_SIZE;
export const DEFAULT_WINDOW_SCALE = 0.85;
export { MAX_WINDOW_SCALE, MIN_WINDOW_SCALE } from '../../shared/window-ipc';

export interface PersistedWindowState {
  version: 5;
  x: number;
  y: number;
  scale: number;
}

export interface WorkAreaDisplay {
  workArea: Rectangle;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const intersectionArea = (first: Rectangle, second: Rectangle): number => {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x),
  );
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y),
  );
  return width * height;
};

export const parseWindowState = (value: unknown): PersistedWindowState | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as {
    version?: number;
    x?: unknown;
    y?: unknown;
    scale?: unknown;
  };
  if (
    (candidate.version !== 1 &&
      candidate.version !== 2 &&
      candidate.version !== 3 &&
      candidate.version !== 4 &&
      candidate.version !== 5) ||
    !isFiniteNumber(candidate.x) ||
    !isFiniteNumber(candidate.y) ||
    !isFiniteNumber(candidate.scale)
  ) {
    return undefined;
  }

  return {
    version: 5,
    x: Math.round(candidate.x),
    y: Math.round(candidate.y),
    scale: clamp(
      (candidate.version < 3 && candidate.scale === 1) ||
        (candidate.version === 3 && candidate.scale === 0.9) ||
        (candidate.version === 4 && candidate.scale === 0.8)
        ? DEFAULT_WINDOW_SCALE
        : candidate.scale,
      MIN_WINDOW_SCALE,
      MAX_WINDOW_SCALE,
    ),
  };
};

const layoutSize = (
  expanded: boolean,
  settings = false,
): Readonly<{ width: number; height: number }> =>
  settings ? SETTINGS_WINDOW_SIZE : expanded ? EXPANDED_WINDOW_SIZE : DEFAULT_WINDOW_SIZE;

export const stateToBounds = (
  state: PersistedWindowState,
  expanded = false,
  settings = false,
): Rectangle => ({
  x: Math.round(state.x),
  y: Math.round(state.y),
  width: Math.round(layoutSize(expanded, settings).width * state.scale),
  height: Math.round(layoutSize(expanded, settings).height * state.scale),
});

export const boundsToState = (bounds: Rectangle, settings = false): PersistedWindowState => ({
  version: 5,
  x: Math.round(bounds.x),
  y: Math.round(bounds.y),
  scale: clamp(
    bounds.height / (settings ? SETTINGS_WINDOW_SIZE.height : DEFAULT_WINDOW_SIZE.height),
    MIN_WINDOW_SCALE,
    MAX_WINDOW_SCALE,
  ),
});

export const resizeStateAroundCenter = (
  state: PersistedWindowState,
  requestedScale: number,
  expanded = false,
  settings = false,
): PersistedWindowState => {
  const currentBounds = stateToBounds(state, expanded, settings);
  const scale = clamp(requestedScale, MIN_WINDOW_SCALE, MAX_WINDOW_SCALE);
  const size = layoutSize(expanded, settings);
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  return {
    version: 5,
    x: Math.round(currentBounds.x + (currentBounds.width - width) / 2),
    y: Math.round(currentBounds.y + (currentBounds.height - height) / 2),
    scale,
  };
};

export const createDefaultWindowState = (workArea: Rectangle): PersistedWindowState => ({
  version: 5,
  x: Math.round(
    workArea.x + workArea.width - DEFAULT_WINDOW_SIZE.width * DEFAULT_WINDOW_SCALE - 24,
  ),
  y: Math.round(
    workArea.y + workArea.height - DEFAULT_WINDOW_SIZE.height * DEFAULT_WINDOW_SCALE - 24,
  ),
  scale: DEFAULT_WINDOW_SCALE,
});

export const keepWindowVisible = (
  state: PersistedWindowState,
  displays: readonly WorkAreaDisplay[],
  primaryWorkArea: Rectangle,
  expanded = false,
  settings = false,
): PersistedWindowState => {
  const size = layoutSize(expanded, settings);
  const originalBounds = stateToBounds(state, expanded, settings);
  let targetWorkArea = primaryWorkArea;
  let greatestIntersection = 0;

  for (const display of displays) {
    const area = intersectionArea(originalBounds, display.workArea);
    if (area > greatestIntersection) {
      greatestIntersection = area;
      targetWorkArea = display.workArea;
    }
  }

  const maximumFittingScale = Math.min(
    MAX_WINDOW_SCALE,
    targetWorkArea.width / size.width,
    targetWorkArea.height / size.height,
  );
  const scale = clamp(
    Math.min(state.scale, maximumFittingScale),
    Math.min(MIN_WINDOW_SCALE, maximumFittingScale),
    maximumFittingScale,
  );
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);

  return {
    version: 5,
    x: Math.round(
      clamp(state.x, targetWorkArea.x, targetWorkArea.x + targetWorkArea.width - width),
    ),
    y: Math.round(
      clamp(state.y, targetWorkArea.y, targetWorkArea.y + targetWorkArea.height - height),
    ),
    scale,
  };
};

export class WindowStateStore {
  private readonly statePath: string;

  public constructor(userDataPath: string) {
    this.statePath = path.join(userDataPath, 'window-state.json');
  }

  public load(): PersistedWindowState | undefined {
    try {
      return parseWindowState(JSON.parse(readFileSync(this.statePath, 'utf8')) as unknown);
    } catch {
      return undefined;
    }
  }

  public save(state: PersistedWindowState): void {
    mkdirSync(path.dirname(this.statePath), { recursive: true });
    writeFileSync(this.statePath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }
}
