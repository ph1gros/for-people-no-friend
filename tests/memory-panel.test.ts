import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemoryCandidateRecord } from '../src/core/memory/contracts';
import { mountMemoryPanel } from '../src/renderer/chat/memory-panel';
import { asPanelElement, fakePanelDocument, panelNodes, panelText } from './helpers/panel-dom';

const candidate = (id = 'candidate'): MemoryCandidateRecord => ({
  id,
  namespace: 'test',
  status: 'pending',
  type: 'fact',
  normalizedKey: 'test',
  content: '测试事实',
  importance: 0.8,
  confidence: 0.9,
  reviewReasons: [],
  evidence: [],
  evidenceDateCount: 0,
  createdAt: 1,
  updatedAt: 1,
  lastSeenAt: 1,
});
const setup = () => {
  fakePanelDocument();
  const api = {
    updateMemoryCandidate: vi.fn(async () => ({ ok: true as const })),
    mergeMemoryCandidates: vi.fn(async () => ({ ok: true as const })),
    confirmMemoryCandidate: vi.fn(async () => ({ ok: true as const })),
    rejectMemoryCandidate: vi.fn(async () => ({ ok: true as const })),
    updateMemory: vi.fn(async () => ({ ok: true as const })),
    deleteMemory: vi.fn(async () => ({ ok: true as const })),
    setMemorySettings: vi.fn(async () => ({ ok: true as const })),
    exportMemories: vi.fn(async () => ({ ok: true as const, canceled: false })),
    backupMemory: vi.fn(async () => ({ ok: true as const, canceled: false })),
    clearMemories: vi.fn(async () => ({ ok: true as const })),
  };
  const reload = vi.fn(async () => undefined);
  const items = [candidate()];
  const panel = mountMemoryPanel({
    api,
    reload,
    getRecords: () => [],
    getCandidates: () => items,
    confirm: () => false,
  });
  panel.render();
  const list = asPanelElement(panel.elements.candidateList);
  const find = (text: string) => panelNodes(list).find((n) => n.textContent === text)!;
  return { panel, api, reload, items, list, find };
};
describe('memory panel', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('keeps candidate edits pending until saved and submits the actual edited content', async () => {
    const { panel, api, list, find, reload } = setup();
    const input = panelNodes(list).find((n) => n.tagName === 'textarea')!;
    input.value = '更新后的事实';
    input.dispatchEvent(new Event('input'));
    find('确认记住').dispatchEvent(new Event('click'));
    expect(api.confirmMemoryCandidate).not.toHaveBeenCalled();
    expect(panel.elements.memoryStatus.textContent).toContain('请先保存');
    find('保存候选修改 *').dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(api.updateMemoryCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ content: '更新后的事实', id: 'candidate' }),
    );
    panel.dispose();
  });
  it('releases replaced list listeners and all panel listeners on disposal', async () => {
    const { panel, api, find } = setup();
    const oldConfirm = find('确认记住');
    panel.render();
    oldConfirm.dispatchEvent(new Event('click'));
    expect(api.confirmMemoryCandidate).not.toHaveBeenCalled();
    const currentConfirm = find('确认记住');
    panel.dispose();
    panel.dispose();
    currentConfirm.dispatchEvent(new Event('click'));
    panel.elements.exportMemoryButton.dispatchEvent(new Event('click'));
    expect(api.confirmMemoryCandidate).not.toHaveBeenCalled();
    expect(api.exportMemories).not.toHaveBeenCalled();
  });
  it('filters current records without stale snapshots and preserves the empty-state wording', () => {
    const { panel, items, list } = setup();
    expect(panelText(list)).toContain('待确认');
    items.length = 0;
    panel.render();
    expect(panelText(list)).toContain('没有待确认项。');
    expect(panel.elements.candidateList.className).toBe('memory-list memory-candidate-list');
    panel.dispose();
  });
});
