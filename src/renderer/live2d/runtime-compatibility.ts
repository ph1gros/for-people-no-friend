export interface PixiTextureSourceCompatibility {
  _gpuData?: Record<number, unknown>;
}

export interface CubismDrawableCompatibility {
  renderOrders?: Int32Array;
}

export interface CubismCoreModelCompatibility {
  drawables: CubismDrawableCompatibility;
  renderOrders?: Int32Array;
}

export interface ScreenDimensions {
  width: number;
  height: number;
}

export interface ContentBounds extends ScreenDimensions {
  x: number;
  y: number;
}

export interface AlphaPixelData extends ScreenDimensions {
  pixels: Uint8ClampedArray;
}

export interface CubismBlinkRuntimeCompatibility {
  coreModel: unknown;
  eyeBlink?: {
    updateParameters(model: unknown, deltaTimeSeconds: number): void;
  };
  motionManager: {
    currentPriority: number;
  };
}

export interface CubismFocusControllerCompatibility {
  focus(x: number, y: number, instant?: boolean): void;
}

export interface CubismParameterRuntimeCompatibility {
  coreModel: {
    setParameterValueById(id: unknown, value: number): void;
  };
  idManager: {
    getId(id: string): unknown;
  };
}

export const applyPixiTextureCompatibility = (sources: PixiTextureSourceCompatibility[]): void => {
  for (const source of sources) {
    source._gpuData ??= Object.create(null) as Record<number, unknown>;
  }
};

export const applyCubismCoreCompatibility = (model: CubismCoreModelCompatibility): void => {
  model.drawables.renderOrders ??= model.renderOrders;
};

export const applyNormalizedTracking = (
  controller: CubismFocusControllerCompatibility,
  point: { x: number; y: number },
  instant = false,
): void => controller.focus(point.x, point.y, instant);

export const fitModelToScreen = (
  model: ScreenDimensions,
  screen: ScreenDimensions,
  presentation: { scale?: number; offsetX?: number; offsetY?: number } = {},
): { scale: number; x: number; y: number } => {
  const baseScale = Math.min(
    Math.max(1, screen.width - 2) / model.width,
    Math.max(1, screen.height - 2) / model.height,
  );
  const presentationScale = presentation.scale ?? 1;
  const scale = baseScale * presentationScale;
  return {
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    x: screen.width * (0.5 + (presentation.offsetX ?? 0) / 2),
    y: screen.height * (0.5 + (presentation.offsetY ?? 0) / 2),
  };
};

export const findAlphaBounds = (
  image: AlphaPixelData,
  minimumAlpha = 8,
): ContentBounds | undefined => {
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = image.pixels[(y * image.width + x) * 4 + 3] ?? 0;
      if (alpha >= minimumAlpha) {
        minimumX = Math.min(minimumX, x);
        minimumY = Math.min(minimumY, y);
        maximumX = Math.max(maximumX, x);
        maximumY = Math.max(maximumY, y);
      }
    }
  }

  const width = maximumX - minimumX + 1;
  const height = maximumY - minimumY + 1;
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { x: minimumX, y: minimumY, width, height }
    : undefined;
};

export const calculateVisibleBottomCorrection = (
  screen: ScreenDimensions,
  visibleBounds: ContentBounds,
): number => {
  return screen.height - (visibleBounds.y + visibleBounds.height);
};

export const updateBlinkDuringMotion = (
  runtime: CubismBlinkRuntimeCompatibility,
  deltaTimeMs: number,
): void => {
  if (runtime.motionManager.currentPriority !== 0) {
    runtime.eyeBlink?.updateParameters(runtime.coreModel, deltaTimeMs / 1_000);
  }
};

export const applyPersistentParameters = (
  runtime: CubismParameterRuntimeCompatibility,
  parameters: Record<string, number>,
): void => {
  for (const [id, value] of Object.entries(parameters)) {
    runtime.coreModel.setParameterValueById(runtime.idManager.getId(id), value);
  }
};
