import { Live2DPerformanceController } from './performance-controller';
import { loadLocalModelManifest, ModelManifestError, resolveLocalModelUrl } from './model-manifest';
import { createLive2DRenderer, loadCubismCore } from './pixi-driver';

export interface LoadedCharacter {
  name: string;
  availableActions: string[];
  controller: Live2DPerformanceController;
  dispose(): void;
}

const describeLoadError = (error: unknown): { title: string; detail: string } => {
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
  badge.textContent = 'Live2D';
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

export const loadCharacter = async (host: HTMLElement): Promise<LoadedCharacter> => {
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
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  renderer.refreshVisibleFrame();

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
