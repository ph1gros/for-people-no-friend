import type { CharacterPerformanceController } from '../character/contracts';
import { CharacterManifestError, loadAnimatedWebpCharacter } from '../character/character-manifest';
import { createAnimatedWebpRenderer } from '../character/animated-webp-driver';
import { Live2DPerformanceController } from './performance-controller';
import { loadLocalModelManifest, ModelManifestError, resolveLocalModelUrl } from './model-manifest';
import { createLive2DRenderer, loadCubismCore } from './pixi-driver';

export interface LoadedCharacter {
  name: string;
  renderer: 'live2d' | 'animated-webp';
  availableActions: string[];
  controller: CharacterPerformanceController;
  dispose(): void;
}

const nextAnimationFrame = (): Promise<void> =>
  new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

export const waitForVisibleCharacterFrame = async (
  refresh: () => boolean,
  maximumAttempts = 120,
  waitForNextFrame: () => Promise<void> = nextAnimationFrame,
): Promise<boolean> => {
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    await waitForNextFrame();
    try {
      if (refresh()) return true;
    } catch {
      // A texture can be unavailable for the first few renderer frames.
    }
  }
  return false;
};

const describeLoadError = (error: unknown): { title: string; detail: string } => {
  if (error instanceof CharacterManifestError) {
    return {
      title: error.message,
      detail:
        error.kind === 'missing'
          ? '请运行 pnpm character:catalog，确认角色资源清单与媒体文件完整。'
          : '请检查 assets/characters 下的版本化角色清单和本地 WebP 文件。',
    };
  }

  if (error instanceof ModelManifestError) {
    const detail =
      error.kind === 'missing'
        ? '请按 assets/models/README.md 放置官方测试模型、Cubism Core 和 model.json，然后重试。'
        : '请检查 assets/models/local/model.json 以及其中引用的本地文件。';
    return { title: error.message, detail };
  }

  const message = error instanceof Error ? error.message : '未知错误';
  return {
    title: 'Live2D 模型加载失败',
    detail: `${message} 请检查 Cubism Core 版本、model3.json 及其纹理/动作引用。`,
  };
};

export const renderCharacterError = (
  host: HTMLElement,
  error: unknown,
  retry: () => void,
): void => {
  const description = describeLoadError(error);
  const panel = document.createElement('section');
  panel.className = 'model-error';
  panel.setAttribute('role', 'alert');

  const badge = document.createElement('span');
  badge.className = 'model-error__badge';
  badge.textContent = '角色资源';
  const title = document.createElement('strong');
  title.textContent = description.title;
  const detail = document.createElement('p');
  detail.textContent = description.detail;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '重新加载';
  button.addEventListener('click', retry, { once: true });
  panel.append(badge, title, detail, button);
  host.replaceChildren(panel);
};

const loadLive2DCharacter = async (host: HTMLElement): Promise<LoadedCharacter> => {
  const manifest = await loadLocalModelManifest();
  await loadCubismCore(resolveLocalModelUrl(manifest.core));
  const renderer = await createLive2DRenderer(
    host,
    resolveLocalModelUrl(manifest.model),
    manifest.parameters,
  );
  const deskpet = window.deskpet;
  const controller = new Live2DPerformanceController(renderer.driver, manifest.controls);
  await controller.start();
  if (!(await waitForVisibleCharacterFrame(renderer.refreshVisibleFrame))) {
    controller.destroy();
    throw new Error('Live2D 模型已载入，但没有生成可见画面。');
  }

  let isTrackingRequestPending = false;
  let isDisposed = false;
  const updateGlobalTracking = async (): Promise<void> => {
    if (isTrackingRequestPending) {
      return;
    }
    isTrackingRequestPending = true;
    try {
      const point = await deskpet?.getGlobalTrackingPoint();
      if (point && !isDisposed) {
        controller.tracking.move(point);
      }
    } finally {
      isTrackingRequestPending = false;
    }
  };
  const trackLocalPointer = (event: PointerEvent): void => {
    const bounds = renderer.canvas.getBoundingClientRect();
    controller.tracking.move({
      x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      y: 1 - ((event.clientY - bounds.top) / bounds.height) * 2,
    });
  };
  const resetLocalPointer = (): void => controller.tracking.move({ x: 0, y: 0 });
  const trackingTimer = deskpet
    ? window.setInterval(() => void updateGlobalTracking(), 16)
    : undefined;
  if (deskpet) {
    void updateGlobalTracking();
  } else {
    renderer.canvas.addEventListener('pointermove', trackLocalPointer);
    renderer.canvas.addEventListener('pointerleave', resetLocalPointer);
  }

  return {
    name: manifest.name,
    renderer: 'live2d',
    availableActions: Object.keys(manifest.controls.actions),
    controller,
    dispose: () => {
      isDisposed = true;
      if (trackingTimer !== undefined) {
        window.clearInterval(trackingTimer);
      }
      renderer.canvas.removeEventListener('pointermove', trackLocalPointer);
      renderer.canvas.removeEventListener('pointerleave', resetLocalPointer);
      controller.destroy();
    },
  };
};

export const loadCharacter = async (
  host: HTMLElement,
  appearanceId = 'local-model',
): Promise<LoadedCharacter> => {
  const manifest = await loadAnimatedWebpCharacter(appearanceId);
  if (!manifest) {
    return loadLive2DCharacter(host);
  }

  const renderer = createAnimatedWebpRenderer(host, manifest);
  const controls = {
    states: Object.fromEntries(
      Object.entries(manifest.channels.states).map(([state, asset]) => [state, { group: asset }]),
    ),
    actions: Object.fromEntries(
      Object.entries(manifest.channels.actions).map(([action, asset]) => [
        action,
        { group: asset },
      ]),
    ),
    emotions: manifest.channels.emotions,
  };
  const controller = new Live2DPerformanceController(renderer.driver, controls);
  await controller.start();
  if (!renderer.image.complete) {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new CharacterManifestError('WebP 角色首帧加载超时。', 'unavailable')),
        5_000,
      );
      renderer.image.addEventListener(
        'load',
        () => {
          window.clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      renderer.image.addEventListener(
        'error',
        () => {
          window.clearTimeout(timeout);
          reject(new CharacterManifestError('WebP 角色资源无法解码。', 'invalid'));
        },
        { once: true },
      );
    });
  }
  if (renderer.image.naturalWidth === 0) {
    controller.destroy();
    throw new CharacterManifestError('WebP 角色资源无法解码。', 'invalid');
  }
  if (!(await waitForVisibleCharacterFrame(renderer.refreshVisibleFrame, 60))) {
    renderer.dispose();
    controller.destroy();
    throw new CharacterManifestError('WebP 角色已载入，但没有生成可见画面。', 'unavailable');
  }

  return {
    name: manifest.name,
    renderer: 'animated-webp',
    availableActions: Object.keys(manifest.channels.actions),
    controller,
    dispose: () => {
      renderer.dispose();
      controller.destroy();
    },
  };
};
