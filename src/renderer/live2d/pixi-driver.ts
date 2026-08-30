import 'pixi.js/unsafe-eval';

import { Application, extensions, Rectangle } from 'pixi.js';
import type { Live2DModel } from 'untitled-pixi-live2d-engine/cubism';

import type {
  Live2DDriver,
  Live2DLipSyncControl,
  MotionReference,
  TrackingPoint,
} from './contracts';
import type { Live2DPresentation } from './model-manifest';
import {
  applyCubismCoreCompatibility,
  applyNormalizedTracking,
  applyPersistentParameters,
  applyPixiTextureCompatibility,
  findAlphaBounds,
  fitModelToScreen,
  updateBlinkDuringMotion,
  type CubismBlinkRuntimeCompatibility,
  type CubismCoreModelCompatibility,
  type CubismParameterRuntimeCompatibility,
  type PixiTextureSourceCompatibility,
} from './runtime-compatibility';

const ACTION_TIMEOUT_MS = 30_000;
const MODEL_LOAD_TIMEOUT_MS = 30_000;
let isLive2DPluginRegistered = false;
let isCubismConfigured = false;

type ModelMotionPriority = NonNullable<Parameters<Live2DModel['motion']>[2]>;

const hasCubismCore = (): boolean =>
  Boolean((window as Window & { Live2DCubismCore?: unknown }).Live2DCubismCore);

const withTimeout = <T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    void task.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });

export const loadCubismCore = async (source: string): Promise<void> => {
  if (hasCubismCore()) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source;
    script.async = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Cubism Core 脚本加载失败。')), {
      once: true,
    });
    document.head.append(script);
  });

  if (!hasCubismCore()) {
    throw new Error('Cubism Core 脚本已读取，但没有提供 Live2DCubismCore。');
  }
};

export class PixiLive2DDriver implements Live2DDriver {
  public constructor(
    private readonly application: Application,
    private readonly model: Live2DModel,
    private readonly priorities: { idle: ModelMotionPriority; force: ModelMotionPriority },
    private readonly disposeRendererBindings: () => void,
    private readonly applyLipSync: (value: number) => void,
  ) {}

  public playState(motion: MotionReference): Promise<boolean> {
    return this.model.motion(motion.group, motion.index, this.priorities.idle, {
      loop: true,
      resetExpression: false,
    });
  }

  public playAction(motion: MotionReference): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (played: boolean): void => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        resolve(played);
      };
      const timeout = window.setTimeout(() => finish(false), ACTION_TIMEOUT_MS);

      void this.model
        .motion(motion.group, motion.index, this.priorities.force, {
          loop: false,
          resetExpression: false,
          onFinish: () => finish(true),
          onError: () => finish(false),
        })
        .then((started) => {
          if (!started) {
            finish(false);
          }
        })
        .catch(() => finish(false));
    });
  }

  public setExpression(expressionId?: string): Promise<boolean> {
    if (!expressionId) {
      this.model.internalModel.motionManager.expressionManager?.resetExpression();
      return Promise.resolve(true);
    }
    return this.model.expression(expressionId);
  }

  public setTracking(point: TrackingPoint, instant = false): void {
    applyNormalizedTracking(
      (
        this.model.internalModel as unknown as {
          focusController: { focus(x: number, y: number, instant?: boolean): void };
        }
      ).focusController,
      point,
      instant,
    );
  }

  public resetTracking(): void {
    applyNormalizedTracking(
      (
        this.model.internalModel as unknown as {
          focusController: { focus(x: number, y: number, instant?: boolean): void };
        }
      ).focusController,
      { x: 0, y: 0 },
    );
  }

  public setLipSync(value: number): void {
    this.applyLipSync(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)));
  }

  public destroy(): void {
    this.disposeRendererBindings();
    this.model.automator.ticker = undefined;
    this.application.destroy(true, { children: true });
  }
}

export interface CreatedLive2DRenderer {
  driver: PixiLive2DDriver;
  canvas: HTMLCanvasElement;
  refreshVisibleFrame(): boolean;
}

export const createLive2DRenderer = async (
  host: HTMLElement,
  modelUrl: string,
  persistentParameters: Record<string, number> = {},
  presentation: Live2DPresentation = { scale: 1, offsetX: 0, offsetY: 0 },
  lipSync?: Live2DLipSyncControl,
): Promise<CreatedLive2DRenderer> => {
  const { configureCubismSDK, Live2DModel, Live2DPlugin, MotionPriority } =
    await import('untitled-pixi-live2d-engine/cubism');
  if (!isCubismConfigured) {
    configureCubismSDK({ memorySizeMB: 64 });
    isCubismConfigured = true;
  }
  if (!isLive2DPluginRegistered) {
    extensions.add(Live2DPlugin);
    isLive2DPluginRegistered = true;
  }

  const application = new Application();
  await application.init({
    resizeTo: host,
    preference: 'webgl',
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio, 2),
  });

  try {
    const model = await withTimeout(
      Live2DModel.from(modelUrl, {
        ticker: application.ticker,
        autoHitTest: false,
        autoFocus: false,
        anchorMode: 'drawable',
        textureOptions: {
          preferCreateImageBitmap: false,
        },
      }),
      MODEL_LOAD_TIMEOUT_MS,
      'Live2D 模型加载超时，请检查模型文件和贴图是否完整。',
    );
    // untitled-pixi-live2d-engine 1.3.5 checks this legacy Pixi cache before
    // asking Pixi 8.13 to upload the texture. Pixi now stores WebGL textures in
    // its renderer texture system, so retain an empty compatibility cache here.
    applyPixiTextureCompatibility(
      model.textures.map((texture) => texture.source as PixiTextureSourceCompatibility),
    );
    const coreModel = (
      model.internalModel.coreModel as unknown as {
        _model: CubismCoreModelCompatibility;
      }
    )._model;
    applyCubismCoreCompatibility(coreModel);
    model.anchor.set(0.5, 0.5);
    const intrinsicSize = { width: model.width, height: model.height };
    let frameRefreshTimer: number | undefined;
    const refreshVisibleFrame = (): boolean => {
      const screen = application.screen;
      application.renderer.render(application.stage);
      const resolution = Math.min(1, 1_024 / Math.max(1, screen.width, screen.height));
      const extracted = application.renderer.extract.pixels({
        target: application.stage,
        frame: new Rectangle(0, 0, screen.width, screen.height),
        resolution,
        clearColor: [0, 0, 0, 0],
      });
      const alphaBounds = findAlphaBounds(extracted);
      const frameRoot = host.parentElement;
      if (!alphaBounds || !frameRoot) {
        return false;
      }
      const pixelToScreenX = screen.width / extracted.width;
      const pixelToScreenY = screen.height / extracted.height;
      const padding = 2;
      const left = Math.max(1, alphaBounds.x * pixelToScreenX - padding);
      const top = Math.max(1, alphaBounds.y * pixelToScreenY - padding);
      const right = Math.min(
        screen.width - 1,
        (alphaBounds.x + alphaBounds.width) * pixelToScreenX + padding,
      );
      const bottom = Math.min(
        screen.height - 1,
        (alphaBounds.y + alphaBounds.height) * pixelToScreenY + padding,
      );
      frameRoot.style.setProperty('--visible-frame-left', `${left}px`);
      frameRoot.style.setProperty('--visible-frame-top', `${top}px`);
      frameRoot.style.setProperty('--visible-frame-width', `${right - left}px`);
      frameRoot.style.setProperty('--visible-frame-height', `${bottom - top}px`);
      return true;
    };
    const scheduleVisibleFrameRefresh = (): void => {
      if (frameRefreshTimer !== undefined) {
        window.clearTimeout(frameRefreshTimer);
      }
      frameRefreshTimer = window.setTimeout(() => refreshVisibleFrame(), 80);
    };
    const layoutModel = (): void => {
      const layout = fitModelToScreen(intrinsicSize, application.screen, presentation);
      model.scale.set(layout.scale);
      model.position.set(layout.x, layout.y);
      if (model.parent) {
        scheduleVisibleFrameRefresh();
      }
    };
    const internalModel = model.internalModel as unknown as CubismBlinkRuntimeCompatibility &
      CubismParameterRuntimeCompatibility & {
        on(event: 'beforeModelUpdate', listener: () => void): void;
        off(event: 'beforeModelUpdate', listener: () => void): void;
      };
    let lipSyncValue = 0;
    const updateBlink = (): void => {
      updateBlinkDuringMotion(internalModel, application.ticker.deltaMS);
      applyPersistentParameters(internalModel, persistentParameters);
      if (lipSync) {
        internalModel.coreModel.setParameterValueById(
          internalModel.idManager.getId(lipSync.mouthOpenParameter),
          Math.max(0, Math.min(1, lipSyncValue)),
        );
      }
    };
    internalModel.on('beforeModelUpdate', updateBlink);
    application.renderer.on('resize', layoutModel);
    layoutModel();
    application.stage.addChild(model);
    host.replaceChildren(application.canvas);
    scheduleVisibleFrameRefresh();
    return {
      driver: new PixiLive2DDriver(
        application,
        model,
        {
          idle: MotionPriority.IDLE,
          force: MotionPriority.FORCE,
        },
        () => {
          if (frameRefreshTimer !== undefined) {
            window.clearTimeout(frameRefreshTimer);
          }
          application.renderer.off('resize', layoutModel);
          internalModel.off('beforeModelUpdate', updateBlink);
        },
        (value) => {
          lipSyncValue = value;
        },
      ),
      canvas: application.canvas,
      refreshVisibleFrame,
    };
  } catch (error) {
    application.destroy(true, { children: true });
    throw error;
  }
};
