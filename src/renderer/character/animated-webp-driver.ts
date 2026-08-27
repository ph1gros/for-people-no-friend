import type { Live2DDriver, MotionReference } from '../live2d/contracts';
import { findAlphaBounds } from '../live2d/runtime-compatibility';
import type { AnimatedWebpCharacterManifest } from './character-manifest';
import { resolveAnimatedWebpAssetUrl } from './character-manifest';

interface RuntimeAsset {
  url: string;
  durationMs: number;
}

const wait = (durationMs: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, durationMs));

export class AnimatedWebpDriver implements Live2DDriver {
  private readonly assets = new Map<string, RuntimeAsset>();
  private readonly idleAssetId: string;
  private readonly neutralAssetId: string;
  private stateAssetId: string;
  private emotionAssetId: string | undefined;
  private currentAssetId: string | undefined;
  private actionActive = false;
  private destroyed = false;

  public constructor(
    private readonly image: HTMLImageElement,
    manifest: AnimatedWebpCharacterManifest,
  ) {
    for (const asset of manifest.assets) {
      this.assets.set(asset.id, {
        url: resolveAnimatedWebpAssetUrl(manifest, asset.file),
        durationMs: asset.durationMs,
      });
    }
    this.idleAssetId = manifest.channels.states.idle;
    this.neutralAssetId = manifest.channels.emotions.neutral;
    this.stateAssetId = this.idleAssetId;
  }

  public async playState(motion: MotionReference): Promise<boolean> {
    this.stateAssetId = motion.group;
    return this.actionActive ? true : this.renderDesired();
  }

  public async playAction(motion: MotionReference): Promise<boolean> {
    const asset = this.assets.get(motion.group);
    if (!asset || this.destroyed) return false;
    this.actionActive = true;
    this.render(motion.group, true);
    await wait(asset.durationMs);
    if (this.destroyed) return false;
    this.actionActive = false;
    this.renderDesired();
    return true;
  }

  public async setExpression(expressionId?: string): Promise<boolean> {
    this.emotionAssetId =
      expressionId && expressionId !== this.neutralAssetId ? expressionId : undefined;
    return this.actionActive ? true : this.renderDesired();
  }

  public setTracking(): void {}

  public resetTracking(): void {}

  public destroy(): void {
    this.destroyed = true;
    this.currentAssetId = undefined;
    this.image.removeAttribute('src');
    this.image.remove();
  }

  private renderDesired(): boolean {
    // One-shot action > active thinking/talking state > short emotion > idle.
    // This prevents an old reply emotion from hiding the next thinking/talking animation.
    const desired =
      this.stateAssetId !== this.idleAssetId
        ? this.stateAssetId
        : (this.emotionAssetId ?? this.idleAssetId);
    return this.render(desired);
  }

  private render(assetId: string, restart = false): boolean {
    const asset = this.assets.get(assetId);
    if (!asset || this.destroyed) return false;
    if (!restart && this.currentAssetId === assetId) return true;
    this.currentAssetId = assetId;
    if (restart) {
      this.image.removeAttribute('src');
      void this.image.offsetWidth;
    }
    this.image.src = asset.url;
    return true;
  }
}

export const createAnimatedWebpRenderer = (
  host: HTMLElement,
  manifest: AnimatedWebpCharacterManifest,
): {
  driver: AnimatedWebpDriver;
  image: HTMLImageElement;
  refreshVisibleFrame(): boolean;
  dispose(): void;
} => {
  const stage = document.createElement('div');
  stage.className = 'animated-character-stage';
  stage.style.setProperty('--character-aspect-width', String(manifest.canvas.width));
  stage.style.setProperty('--character-aspect-height', String(manifest.canvas.height));
  stage.style.setProperty('--character-display-scale', String(manifest.presentation.scale));
  const image = document.createElement('img');
  image.className = 'animated-character-stage__image';
  image.alt = '';
  image.draggable = false;
  stage.append(image);
  host.replaceChildren(stage);
  const scratch = document.createElement('canvas');
  const refreshVisibleFrame = (): boolean => {
    if (image.naturalWidth === 0 || image.naturalHeight === 0) return false;
    scratch.width = image.naturalWidth;
    scratch.height = image.naturalHeight;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    const frameRoot = host.parentElement;
    if (!context || !frameRoot) return false;
    context.clearRect(0, 0, scratch.width, scratch.height);
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, scratch.width, scratch.height);
    const alphaBounds = findAlphaBounds({
      pixels: pixels.data,
      width: pixels.width,
      height: pixels.height,
    });
    if (!alphaBounds) return false;

    const scale = Math.min(
      image.clientWidth / image.naturalWidth,
      image.clientHeight / image.naturalHeight,
    );
    const renderedWidth = image.naturalWidth * scale;
    const renderedHeight = image.naturalHeight * scale;
    const imageLeft = image.offsetLeft + (image.clientWidth - renderedWidth) / 2;
    const imageTop = image.offsetTop + image.clientHeight - renderedHeight;
    const padding = 2;
    const left = Math.max(1, imageLeft + alphaBounds.x * scale - padding);
    const top = Math.max(1, imageTop + alphaBounds.y * scale - padding);
    const right = Math.min(
      host.clientWidth - 1,
      imageLeft + (alphaBounds.x + alphaBounds.width) * scale + padding,
    );
    const bottom = Math.min(
      host.clientHeight - 1,
      imageTop + (alphaBounds.y + alphaBounds.height) * scale + padding,
    );
    frameRoot.style.setProperty('--visible-frame-left', `${left}px`);
    frameRoot.style.setProperty('--visible-frame-top', `${top}px`);
    frameRoot.style.setProperty('--visible-frame-width', `${Math.max(0, right - left)}px`);
    frameRoot.style.setProperty('--visible-frame-height', `${Math.max(0, bottom - top)}px`);
    return true;
  };
  image.addEventListener('load', refreshVisibleFrame);
  window.addEventListener('resize', refreshVisibleFrame);
  return {
    driver: new AnimatedWebpDriver(image, manifest),
    image,
    refreshVisibleFrame,
    dispose: () => {
      image.removeEventListener('load', refreshVisibleFrame);
      window.removeEventListener('resize', refreshVisibleFrame);
    },
  };
};
