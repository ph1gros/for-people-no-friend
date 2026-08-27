import { describe, expect, it, vi } from 'vitest';

import { waitForVisibleCharacterFrame } from '../src/renderer/live2d/character-runtime';

import {
  applyCubismCoreCompatibility,
  applyNormalizedTracking,
  applyPersistentParameters,
  applyPixiTextureCompatibility,
  findAlphaBounds,
  fitModelToScreen,
  updateBlinkDuringMotion,
} from '../src/renderer/live2d/runtime-compatibility';

describe('Live2D runtime compatibility', () => {
  it('provides the Pixi cache shape expected by the Live2D renderer', () => {
    const existingCache = { 7: 'texture' };
    const sources = [{}, { _gpuData: existingCache }];

    applyPixiTextureCompatibility(sources);

    expect(sources[0]._gpuData).toEqual({});
    expect(sources[1]._gpuData).toBe(existingCache);
  });

  it('maps the Cubism R5 model render order to the legacy drawable field', () => {
    const renderOrders = new Int32Array([2, 0, 1]);
    const model = { drawables: {}, renderOrders };

    applyCubismCoreCompatibility(model);

    expect(model.drawables.renderOrders).toBe(renderOrders);
  });

  it('does not replace a render order already supplied by older Core versions', () => {
    const legacyRenderOrders = new Int32Array([0, 1]);
    const model = {
      drawables: { renderOrders: legacyRenderOrders },
      renderOrders: new Int32Array([1, 0]),
    };

    applyCubismCoreCompatibility(model);

    expect(model.drawables.renderOrders).toBe(legacyRenderOrders);
  });

  it('passes normalized tracking coordinates to the Cubism focus controller', () => {
    const focus = vi.fn();

    applyNormalizedTracking({ focus }, { x: -0.75, y: 0.5 }, true);

    expect(focus).toHaveBeenCalledWith(-0.75, 0.5, true);
  });

  it('keeps model scaling uniform and centered after a resize', () => {
    expect(fitModelToScreen({ width: 200, height: 400 }, { width: 360, height: 520 })).toEqual({
      scale: 1.295,
      x: 180,
      y: 260,
    });
  });

  it('layers model-specific presentation on top of normalized fitting', () => {
    expect(
      fitModelToScreen(
        { width: 200, height: 400 },
        { width: 360, height: 520 },
        { scale: 0.8, offsetX: 0.25, offsetY: -0.5 },
      ),
    ).toEqual({ scale: 1.036, x: 225, y: 130 });
  });

  it('finds the final rendered alpha bounds independently of model structure', () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4);
    for (const [x, y] of [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ]) {
      pixels[(y * 4 + x) * 4 + 3] = 255;
    }

    expect(findAlphaBounds({ pixels, width: 4, height: 4 })).toEqual({
      x: 1,
      y: 1,
      width: 2,
      height: 2,
    });
  });

  it('ignores fully transparent rendered pixels', () => {
    expect(
      findAlphaBounds({ pixels: new Uint8ClampedArray(16), width: 2, height: 2 }),
    ).toBeUndefined();
  });

  it('adds automatic blinking while an idle motion is active', () => {
    const updateParameters = vi.fn();
    const runtime = {
      coreModel: {},
      eyeBlink: { updateParameters },
      motionManager: { currentPriority: 1 },
    };

    updateBlinkDuringMotion(runtime, 16);

    expect(updateParameters).toHaveBeenCalledWith(runtime.coreModel, 0.016);
  });

  it('reapplies model-specific persistent parameters every frame', () => {
    const setParameterValueById = vi.fn();
    const runtime = {
      coreModel: { setParameterValueById },
      idManager: { getId: (id: string) => `core:${id}` },
    };

    applyPersistentParameters(runtime, { ParamBodyVariant: 1 });

    expect(setParameterValueById).toHaveBeenCalledWith('core:ParamBodyVariant', 1);
  });

  it('waits for a visible Live2D frame instead of accepting an empty canvas', async () => {
    const refresh = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);

    await expect(waitForVisibleCharacterFrame(refresh, 5, async () => undefined)).resolves.toBe(
      true,
    );
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('reports a Live2D renderer that remains fully transparent', async () => {
    const refresh = vi.fn(() => false);

    await expect(waitForVisibleCharacterFrame(refresh, 3, async () => undefined)).resolves.toBe(
      false,
    );
  });
});
