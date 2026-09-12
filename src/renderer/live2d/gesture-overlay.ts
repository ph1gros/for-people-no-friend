import type { NativeEmotionCore } from './emotion-overlay';

export type NativeGesture = 'nod' | 'shake';
const DURATION_MS = 1200;
const PARAMETERS = { nod: 'ParamAngleY', shake: 'ParamAngleX' } as const;
type HeadParameter = { id: unknown; index: number; min: number; max: number };

/** Small additive head gestures, using only standard parameters actually present in the model. */
export class NativeGestureOverlay {
  private readonly parameters = new Map<NativeGesture, HeadParameter>();
  private active:
    | { gesture: NativeGesture; start: number; rendered: boolean; finish(played: boolean): void }
    | undefined;

  public constructor(
    private readonly core: NativeEmotionCore,
    ids: { getId(id: string): unknown },
    excluded: readonly string[] = [],
  ) {
    for (const gesture of ['nod', 'shake'] as const) {
      const name = PARAMETERS[gesture];
      if (excluded.includes(name)) continue;
      const id = ids.getId(name);
      // Looking up an absent parameter by index can create a virtual slot; enumerate instead.
      for (let index = 0; index < core.getParameterCount(); index++) {
        if (core.getParameterId(index) !== id) continue;
        const min = core.getParameterMinimumValue(index),
          max = core.getParameterMaximumValue(index);
        if (Number.isFinite(min) && Number.isFinite(max) && max > min)
          this.parameters.set(gesture, { id, index, min, max });
        break;
      }
    }
  }

  public get supportedActions(): NativeGesture[] {
    return [...this.parameters.keys()];
  }

  public play(gesture: NativeGesture, now = performance.now()): Promise<boolean> {
    if (!this.parameters.has(gesture) || this.active) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(this.active?.rendered ?? false), DURATION_MS);
      const finish = (played: boolean): void => {
        clearTimeout(timer);
        this.active = undefined;
        resolve(played);
      };
      this.active = { gesture, start: now, rendered: false, finish };
    });
  }

  public cancel(): void {
    this.active?.finish(false);
  }

  public apply(now = performance.now()): void {
    const active = this.active;
    if (!active) return;
    const progress = Math.max(0, Math.min(1, (now - active.start) / DURATION_MS));
    if (progress >= 1) {
      active.finish(active.rendered);
      return;
    }
    const parameter = this.parameters.get(active.gesture)!;
    const base = this.core.getParameterValueByIndex(parameter.index);
    if (!Number.isFinite(base)) return;
    const envelope = Math.sin(Math.PI * progress) ** 2;
    const wave = active.gesture === 'nod' ? -envelope : Math.sin(progress * Math.PI * 2) * envelope;
    const offset = wave * Math.min(6, (parameter.max - parameter.min) * 0.1);
    this.core.setParameterValueById(
      parameter.id,
      Math.max(parameter.min, Math.min(parameter.max, base + offset)),
    );
    active.rendered = true;
  }
}
