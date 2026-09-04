import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountCharacterSettings } from '../src/renderer/chat/settings-character';
import { asPanelElement, fakePanelDocument, panelNodes, PanelElement } from './helpers/panel-dom';
import type { CharacterResearchCandidate } from '../src/core/character/character-research';
const setup = () => {
  fakePanelDocument();
  vi.useFakeTimers();
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const api = {
    listCharacters: vi.fn(async () => []),
    activateCharacter: vi.fn(),
    removeCharacter: vi.fn(),
    createLocalCharacter: vi.fn(),
    clearInactiveCharacters: vi.fn(),
    previewCharacterPackage: vi.fn(),
    confirmCharacterPackageImport: vi.fn(),
    exportActiveCharacterPackage: vi.fn(),
    searchCharacters: vi.fn(),
    buildCharacterDraft: vi.fn(),
    cancelCharacterResearch: vi.fn(async () => true),
    getWorkGlossaryStatus: vi.fn(),
    syncWorkGlossary: vi.fn(),
  };
  const confirmAction = vi.fn(async () => true);
  const panel = mountCharacterSettings({
    api,
    resizeTarget: new PanelElement('form') as unknown as Element,
    confirmAction,
    createRequestId: (prefix) => prefix + '_test',
    refreshActiveCharacter: vi.fn(),
    setStatus: vi.fn(),
    showCharacterSettings: vi.fn(),
    onNameChanged: vi.fn(),
  });
  const nodes = () => panelNodes(asPanelElement(panel.pageBody));
  return {
    panel,
    api,
    disconnect,
    confirmAction,
    nodes,
    button: (text: string) => nodes().find((n) => n.textContent === text)!,
  };
};
describe('character settings panel', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('requires confirmation for research and cancels its in-flight request on disposal', async () => {
    const { panel, api, button, confirmAction, disconnect } = setup();
    panel.elements.characterSearchNameInput.value = 'Test character';
    let resolve: ((value: unknown) => void) | undefined;
    api.searchCharacters.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    button('联网查找').dispatchEvent(new Event('click'));
    await Promise.resolve();
    await Promise.resolve();
    expect(confirmAction).toHaveBeenCalledOnce();
    expect(api.searchCharacters).toHaveBeenCalledOnce();
    const prior = panel.elements.characterSearchStatus.textContent;
    panel.dispose();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(api.cancelCharacterResearch).toHaveBeenCalledWith({
      requestId: 'character_search_test',
    });
    resolve!({ ok: true, candidates: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(panel.elements.characterSearchStatus.textContent).toBe(prior);
    button('联网查找').dispatchEvent(new Event('click'));
    expect(api.searchCharacters).toHaveBeenCalledOnce();
  });
  it('detaches obsolete candidate actions when results are replaced', () => {
    const { panel, api, nodes } = setup();
    const candidate = {
      id: 'fake',
      name: 'Test',
      sourceName: 'Fixture',
      sourceWork: '',
      description: 'sample',
      matchReason: 'fixture',
    } as CharacterResearchCandidate;
    panel.renderCharacterCandidates([candidate]);
    const old = nodes().find((n) => n.className === 'character-candidate')!;
    panel.renderCharacterCandidates([]);
    old.dispatchEvent(new Event('click'));
    expect(api.buildCharacterDraft).not.toHaveBeenCalled();
    panel.dispose();
  });
  it('retains source links in unchanged roleplay examples and clears only draft lore', () => {
    const { panel } = setup();
    const lore = {
      canonicalName: 'Test',
      aliases: ['Alias'],
      sourceWork: 'Work',
      identity: 'Identity',
      personality: 'Kind',
      background: 'Background',
      relationships: [],
      speechStyle: 'Style',
      sampleLines: ['Hello'],
      roleplayExamples: [
        {
          scene: 'scene',
          emotion: 'happy',
          trigger: 'hello',
          attitude: 'kind',
          line: 'Hi',
          sourceId: 'source-1',
        },
      ],
      sources: [
        { id: 'source-1', siteName: 'Fixture', title: 'Source', url: 'https://example.com/' },
      ],
    };
    panel.fillLoreEditor(lore);
    expect(panel.readLoreEditor('Test')?.roleplayExamples?.[0]?.sourceId).toBe('source-1');
    panel.fillLoreEditor();
    expect(panel.readLoreEditor('Test')).toBeUndefined();
    panel.resizeLoreTextareas();
    expect(vi.getTimerCount()).toBe(1);
    panel.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
