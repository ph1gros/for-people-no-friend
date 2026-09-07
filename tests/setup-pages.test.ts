import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCharacterPage,
  createProviderPage,
  type SetupPageContext,
} from '../src/renderer/setup/pages';
import {
  DEFAULT_SETUP_SELECTIONS,
  type DeskpetSetupApi,
  type SetupViewState,
} from '../src/shared/setup-ipc';
import { fakePanelDocument, PanelElement, panelNodes, panelText } from './helpers/panel-dom';

const contextFor = (api: Partial<DeskpetSetupApi>): SetupPageContext => ({
  api: api as DeskpetSetupApi,
  getSelections: () => ({ ...DEFAULT_SETUP_SELECTIONS }),
  updateSelections: vi.fn(),
  setStatus: vi.fn(),
  setNextEnabled: vi.fn(),
  showView: vi.fn(),
  run: async (operation) => operation(),
});
const view = {} as SetupViewState;
const findButton = (host: PanelElement, label: string): PanelElement => {
  const button = panelNodes(host).find(
    (node) => node.tagName === 'button' && node.textContent === label,
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
};

describe('setup page confirmations', () => {
  beforeEach(fakePanelDocument);
  afterEach(() => vi.unstubAllGlobals());

  it('runs Live2D imports inside the shared navigation lock', async () => {
    let finish!: (value: { ok: true; canceled: true }) => void;
    const context = contextFor({
      getSetupCharacterStatus: vi.fn().mockResolvedValue({ activeCharacterName: 'Fixture' }),
      importSetupLive2DModel: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    });
    context.run = vi.fn(async (operation) => operation());
    const host = new PanelElement('div');
    await createCharacterPage().render(host as unknown as HTMLElement, view, context);
    findButton(host, '选择 .model3.json…').dispatchEvent(new Event('click'));
    try {
      expect(context.run).toHaveBeenCalledTimes(1);
      expect(context.api.importSetupLive2DModel).toHaveBeenCalledTimes(1);
    } finally {
      finish({ ok: true, canceled: true });
    }
  });

  it.each(['none', 'replace'] as const)(
    'requires explicit confirmation for a %s character import',
    async (conflict) => {
      const confirm = vi.fn().mockResolvedValue({ ok: true, canceled: false });
      const context = contextFor({
        getSetupCharacterStatus: vi.fn().mockResolvedValue({ activeCharacterName: 'Placeholder' }),
        previewSetupCharacterPackage: vi.fn().mockResolvedValue({
          ok: true,
          canceled: false,
          preview: {
            previewId: 'preview-fixture',
            characterName: 'Fixture',
            sourceWork: 'Test work',
            conflict,
            attribution: [
              {
                title: 'Author',
                licenseNote: 'Noncommercial fixture',
                url: 'https://example.invalid',
              },
            ],
          },
        }),
        confirmSetupCharacterPackage: confirm,
      });
      const host = new PanelElement('div');
      await createCharacterPage().render(host as unknown as HTMLElement, view, context);
      findButton(host, '选择角色包…').dispatchEvent(new Event('click'));
      await vi.waitFor(() => expect(panelText(host)).toContain('Noncommercial fixture'));
      expect(confirm).not.toHaveBeenCalled();
      findButton(host, conflict === 'replace' ? '确认替换并导入' : '确认导入').dispatchEvent(
        new Event('click'),
      );
      await vi.waitFor(() =>
        expect(confirm).toHaveBeenCalledWith({
          previewId: 'preview-fixture',
          replaceExisting: conflict === 'replace',
        }),
      );
    },
  );

  it('locks provider edits and navigation while a connection test is pending', async () => {
    let resolveTest!: (result: { ok: true; latencyMs: number }) => void;
    const context = contextFor({
      getSetupProviderStatus: vi.fn().mockResolvedValue({
        providerId: 'openai-compatible',
        baseUrl: 'https://example.invalid',
        modelId: 'fixture-model',
        hasSecret: false,
        options: [],
      }),
      applySetupProvider: vi.fn().mockResolvedValue({ ok: true }),
      testSetupProvider: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveTest = resolve;
          }),
      ),
    });
    const host = new PanelElement('div');
    const page = createProviderPage();
    await page.render(host as unknown as HTMLElement, view, context);
    findButton(host, '测试连接').dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(context.api.testSetupProvider).toHaveBeenCalled());
    expect(
      panelNodes(host)
        .filter((node) => node.tagName === 'input')
        .every((node) => node.disabled),
    ).toBe(true);
    expect(context.setNextEnabled).toHaveBeenLastCalledWith(false);
    await expect(page.commit!(context)).rejects.toThrow('请等待连接测试结束');
    resolveTest({ ok: true, latencyMs: 1 });
    await vi.waitFor(() => expect(context.setNextEnabled).toHaveBeenLastCalledWith(true));
    expect(findButton(host, '测试连接').disabled).toBe(false);
  });
});
