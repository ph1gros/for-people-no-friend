import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountVTubeSettings } from '../src/renderer/chat/settings-vtube';
import { asPanelElement, fakePanelDocument, panelNodes } from './helpers/panel-dom';
const setup = () => {
  vi.useFakeTimers();
  fakePanelDocument();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  const api = {
    getVTubeStudioStatus: vi.fn(),
    inspectVTubeStudio: vi.fn(),
    setVTubeStudioSettings: vi.fn(async () => ({ ok: true })),
    authorizeVTubeStudio: vi.fn(),
    launchVTubeStudio: vi.fn(),
    installBundledVTubeStudioModel: vi.fn(),
    presentInVTubeStudio: vi.fn(async () => ({ ok: true })),
    previewVTubeStudioExpression: vi.fn(),
    setViewerExSettings: vi.fn(async () => ({ ok: true })),
    presentInViewerEx: vi.fn(async () => true),
  };
  const panel = mountVTubeSettings({
    api,
    setDisplayModeInputs: vi.fn(),
    persistCharacterDisplayMode: vi.fn(async () => ({ ok: true })),
    closeDrawers: vi.fn(),
  });
  const nodes = [
    ...panelNodes(asPanelElement(panel.elements.viewerExSettingsPanel)),
    ...panelNodes(asPanelElement(panel.elements.vTubeStudioSettingsPanel)),
  ];
  return { api, panel, button: (text: string) => nodes.find((n) => n.textContent === text)! };
};
describe('external character display settings', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('does not save suggested model mappings until the user confirms', async () => {
    const { panel, api, button } = setup();
    panel.displayVTubeStudioInventory(
      {
        model: { id: 'model-a', name: 'Model A', loaded: true },
        expressions: [],
        hotkeys: [],
        parameters: [],
      },
      {
        modelId: 'model-a',
        modelName: 'Model A',
        suggestions: { emotionExpressions: { happy: 'smile.exp3.json' }, actionHotkeys: {} },
      },
    );
    expect(api.setVTubeStudioSettings).not.toHaveBeenCalled();
    button('确认自动识别的映射').dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(api.setVTubeStudioSettings).toHaveBeenCalledWith({
      settings: expect.objectContaining({
        modelMappings: expect.objectContaining({
          'model-a': expect.objectContaining({ emotionExpressions: { happy: 'smile.exp3.json' } }),
        }),
      }),
    });
    panel.dispose();
  });
  it('cancels the delayed expression restore when the panel is disposed', async () => {
    const { panel, api, button } = setup();
    const test = button('测试惊讶表情');
    test.dispatchEvent(new Event('click'));
    await Promise.resolve();
    expect(api.presentInVTubeStudio).toHaveBeenCalledWith({ emotion: 'surprised' });
    expect(vi.getTimerCount()).toBe(1);
    panel.dispose();
    await vi.advanceTimersByTimeAsync(4000);
    expect(vi.getTimerCount()).toBe(0);
    test.dispatchEvent(new Event('click'));
    expect(api.presentInVTubeStudio).toHaveBeenCalledTimes(1);
  });
  it('ignores a late inspection result and unregisters selection listeners', async () => {
    const { panel, api } = setup();
    let resolve: ((value: unknown) => void) | undefined;
    api.getVTubeStudioStatus.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const selected = new EventTarget();
    const callback = vi.fn();
    panel.listenForSelection(selected, callback);
    const pending = panel.inspectSelectedVTubeStudio();
    panel.dispose();
    selected.dispatchEvent(new Event('click'));
    expect(callback).not.toHaveBeenCalled();
    resolve!({ settings: { enabled: true }, authorized: true });
    await expect(pending).resolves.toBe(false);
    expect(api.inspectVTubeStudio).not.toHaveBeenCalled();
  });
});
