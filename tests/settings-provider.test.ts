import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountProviderSettings } from '../src/renderer/chat/settings-provider';
import { asPanelElement, fakePanelDocument, panelNodes } from './helpers/panel-dom';

const setup = () => {
  fakePanelDocument();
  const api = {
    getProviderSecretStatus: vi.fn(async () => ({
      anthropic: false,
      deepseek: false,
      'openai-compatible': false,
    })),
    testProviderConnection: vi.fn(async () => ({ ok: true as const, latencyMs: 12 })),
    deleteProviderSecret: vi.fn(async () => ({ ok: true as const })),
    cancelProviderRequest: vi.fn(async () => true),
  };
  const save = vi.fn(async () => true);
  const panel = mountProviderSettings({
    api,
    save,
    setStatus: vi.fn(),
    formatError: (e) => e.message,
    createRequestId: () => 'provider_test',
    confirm: () => false,
  });
  const button = panelNodes(asPanelElement(panel.elements.connectionActions)).find(
    (n) => n.textContent === '测试连接',
  )!;
  return { panel, api, save, button };
};
describe('provider settings panel', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('updates compatibility fields and prevents a duplicate remote credential entry', async () => {
    const { panel } = setup();
    const e = panel.elements;
    e.providerSelect.value = 'openai-compatible';
    e.providerSelect.dispatchEvent(new Event('change'));
    expect(e.baseUrlField.hidden).toBe(false);
    e.providerSelect.value = 'anthropic';
    e.remoteProviderSelect.value = 'anthropic';
    e.allowRemoteComplexTasksInput.checked = true;
    await panel.updateSecretStatus();
    panel.updateProviderVisibility();
    expect(e.baseUrlField.hidden).toBe(true);
    expect(e.remoteApiKeyInput.disabled).toBe(true);
    e.remoteProviderSelect.value = 'deepseek';
    await panel.updateSecretStatus();
    expect(e.remoteApiKeyInput.disabled).toBe(false);
    panel.dispose();
  });
  it('requires a model before saving or testing the connection', async () => {
    const { panel, api, save, button } = setup();
    button.dispatchEvent(new Event('click'));
    expect(save).not.toHaveBeenCalled();
    expect(api.testProviderConnection).not.toHaveBeenCalled();
    expect(panel.elements.connectionStatus.textContent).toContain('请填写');
    panel.elements.modelInput.value = 'fake-model';
    panel.elements.providerSelect.value = 'anthropic';
    button.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(api.testProviderConnection).toHaveBeenCalledOnce());
    expect(api.testProviderConnection).toHaveBeenCalledWith({
      requestId: 'provider_test',
      providerId: 'anthropic',
      modelId: 'fake-model',
    });
    panel.dispose();
  });
  it('cancels an outstanding test and releases listeners on disposal', async () => {
    const { panel, api, button } = setup();
    panel.elements.modelInput.value = 'fake-model';
    let complete: ((value: { ok: true; latencyMs: number }) => void) | undefined;
    api.testProviderConnection.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    button.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(api.testProviderConnection).toHaveBeenCalledOnce());
    panel.dispose();
    expect(api.cancelProviderRequest).toHaveBeenCalledWith({ requestId: 'provider_test' });
    const prior = panel.elements.connectionStatus.textContent;
    complete!({ ok: true, latencyMs: 12 });
    await Promise.resolve();
    await Promise.resolve();
    expect(panel.elements.connectionStatus.textContent).toBe(prior);
    button.dispatchEvent(new Event('click'));
    expect(api.testProviderConnection).toHaveBeenCalledOnce();
  });
});
