import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountSpeechSettings } from '../src/renderer/chat/settings-speech';
import { DEFAULT_SPEECH_SETTINGS, type SpeechStatus } from '../src/shared/speech-ipc';
import { asPanelElement, fakePanelDocument, panelNodes } from './helpers/panel-dom';

const setup = () => {
  vi.useFakeTimers();
  fakePanelDocument();
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    confirm: () => false,
  });
  let status: SpeechStatus = {
    settings: { ...DEFAULT_SPEECH_SETTINGS },
    apiKeySaved: false,
    output: {
      available: false,
      preparing: true,
      dataDestination: 'this-device',
      detail: 'preparing',
      providerId: 'genie-tts',
    },
    input: { available: false, modes: [], dataDestination: 'none', detail: 'input' },
  };
  const api = {
    getSpeechStatus: vi.fn(async () => ({
      ...status,
      output: { ...status.output, preparing: false, detail: 'ready' },
    })),
    deleteSpeechSecret: vi.fn(),
    getLocalSpeechAssetStatus: vi.fn(),
    exportLocalVoice: vi.fn(),
    openSpeechTrainingSources: vi.fn(),
    launchSpeechTrainer: vi.fn(),
  };
  const panel = mountSpeechSettings({
    api,
    getStatus: () => status,
    setReadiness: (next) => {
      status = next;
    },
    onStatus: vi.fn(),
  });
  const nodes = panelNodes(asPanelElement(panel.elements.speechSettingsPanel));
  return { panel, api, nodes, getStatus: () => status };
};
describe('speech settings panel', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('applies the paired Genie preset and keeps custom language editing available', () => {
    const { panel, nodes } = setup();
    const e = panel.elements;
    e.speechProviderSelect.value = 'genie-tts';
    e.speechProviderSelect.dispatchEvent(new Event('change'));
    expect(e.speechVoiceInput.value).toBe('mika');
    expect(e.speechApiKeyInput.disabled).toBe(true);
    const language = nodes.find(
      (n) => n.tagName === 'select' && n.options.some((o) => o.value === 'custom'),
    )!;
    language.value = 'custom';
    language.dispatchEvent(new Event('change'));
    const custom = nodes.find((n) => n.placeholder === '例如：fr-FR')!;
    expect(custom.focused).toBe(true);
    custom.value = 'fr-FR';
    expect(e.readSpeechLanguage()).toBe('fr-FR');
    panel.dispose();
  });
  it('polls readiness without overwriting a draft, and stops polling on disposal', async () => {
    const { panel, api, getStatus } = setup();
    panel.elements.speechModelInput.value = 'unsaved-model';
    await vi.advanceTimersByTimeAsync(1000);
    expect(getStatus().output.detail).toBe('ready');
    expect(panel.elements.speechModelInput.value).toBe('unsaved-model');
    panel.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.getSpeechStatus).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('clears feedback timers and listeners and ignores a late readiness result', async () => {
    const { panel, api, nodes } = setup();
    let resolve: ((s: SpeechStatus) => void) | undefined;
    api.getSpeechStatus.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    const button = nodes.find((n) => n.textContent === '确认')!;
    button.dispatchEvent(new Event('click'));
    expect(button.textContent).toBe('请检查');
    const before = panel.elements.speechStatus.textContent;
    panel.dispose();
    expect(vi.getTimerCount()).toBe(0);
    resolve!({ output: { detail: 'late' } } as SpeechStatus);
    await Promise.resolve();
    await Promise.resolve();
    expect(panel.elements.speechStatus.textContent).toBe(before);
    button.textContent = 'closed';
    button.dispatchEvent(new Event('click'));
    expect(button.textContent).toBe('closed');
  });
});
