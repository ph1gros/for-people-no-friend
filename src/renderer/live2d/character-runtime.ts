import type { CharacterPresentationPort } from '../../core/presentation/character-presentation';
import { AutonomousActivityPresentation } from './autonomous-activity';
import { Live2DPerformanceController } from './performance-controller';
import {
  inspectLive2DModelCapabilities,
  type Live2DModelCapabilityReport,
} from './model-capabilities';
import { loadLocalModelManifest, ModelManifestError, resolveLocalModelUrl } from './model-manifest';
import { createLive2DRenderer } from './pixi-driver';
import { CubismCoreError, loadCubismCore } from './cubism-core-loader';

export interface LoadedCharacter {
  name: string;
  availableActions: string[];
  capabilityReport: Live2DModelCapabilityReport;
  presentation: CharacterPresentationPort;
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
  if (error instanceof CubismCoreError) {
    return {
      title: 'Live2D 运行时不可用',
      detail: `${error.message} 已导入的模型会保留。请使用包含可用 Live2D 运行时的应用构建；也可以在设置中切换到 VTube Studio 或 ViewerEX。`,
    };
  }
  if (error instanceof ModelManifestError) {
    const detail =
      error.kind === 'missing'
        ? '请在“设置 → 模型显示方式 → 纯 Live2D”中导入模型，或在“角色”中导入包含模型的角色包，然后重试。'
        : '请在“设置 → 模型显示方式 → 纯 Live2D”中重新导入完整模型，或重新导入当前角色的模型包，然后重试。';
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
  const modelResponse = await fetch(resolveLocalModelUrl(manifest.model, manifest.assetRoot), {
    cache: 'no-store',
  });
  if (!modelResponse.ok) {
    throw new ModelManifestError(
      `模型文件读取失败（HTTP ${modelResponse.status}）。`,
      'unavailable',
    );
  }
  const capabilityReport = inspectLive2DModelCapabilities(manifest, await modelResponse.json());
  await loadCubismCore();
  const renderer = await createLive2DRenderer(
    host,
    resolveLocalModelUrl(manifest.model, manifest.assetRoot),
    manifest.parameters,
    manifest.presentation,
    manifest.controls.lipSync,
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
  const beginInteraction = (): void => renderer.driver.setGestureInteraction(true);
  const endInteraction = (): void => renderer.driver.setGestureInteraction(false);
  const cancelInteraction = (): void => {
    beginInteraction();
    endInteraction();
  };
  document.addEventListener('pointerdown', beginInteraction, true);
  document.addEventListener('pointerup', endInteraction, true);
  document.addEventListener('pointercancel', endInteraction, true);
  window.addEventListener('blur', cancelInteraction);
  window.addEventListener('focus', endInteraction);
  const availableActions = [
    ...new Set([...Object.keys(manifest.controls.actions), ...renderer.driver.supportedGestures]),
  ];
  const autonomousPresentation = new AutonomousActivityPresentation(
    controller,
    availableActions,
    (action) => controller.action.enqueue(action),
  );
  autonomousPresentation.start();
  return {
    name: manifest.name,
    availableActions,
    capabilityReport,
    presentation: autonomousPresentation,
    dispose: () => {
      isDisposed = true;
      autonomousPresentation.destroy();
      document.removeEventListener('pointerdown', beginInteraction, true);
      document.removeEventListener('pointerup', endInteraction, true);
      document.removeEventListener('pointercancel', endInteraction, true);
      window.removeEventListener('blur', cancelInteraction);
      window.removeEventListener('focus', endInteraction);
      if (trackingTimer !== undefined) {
        window.clearInterval(trackingTimer);
      }
      renderer.canvas.removeEventListener('pointermove', trackLocalPointer);
      renderer.canvas.removeEventListener('pointerleave', resetLocalPointer);
      controller.destroy();
    },
  };
};
