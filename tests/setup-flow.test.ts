import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETUP_SELECTIONS,
  SetupFlow,
  createDefaultSetupSteps,
  type SetupStepDefinition,
} from '../src/core/setup/setup-flow';

describe('setup wizard navigation', () => {
  it('walks the default pages forwards and backwards', () => {
    const flow = new SetupFlow();

    expect(flow.getState()).toMatchObject({
      stepId: 'welcome',
      stepIndex: 0,
      canGoBack: false,
      canGoNext: true,
      isFinalStep: false,
      visibleSteps: ['welcome', 'mode', 'provider', 'review', 'finish'],
    });

    expect(flow.next()).toBe(true);
    expect(flow.getState().stepId).toBe('mode');
    expect(flow.next()).toBe(true);
    expect(flow.getState().stepId).toBe('provider');
    expect(flow.back()).toBe(true);
    expect(flow.getState()).toMatchObject({ stepId: 'mode', canGoBack: true });
  });

  it('shows the character page only on the custom path', () => {
    const recommended = new SetupFlow();
    expect(recommended.getState().visibleSteps).toEqual([
      'welcome',
      'mode',
      'provider',
      'review',
      'finish',
    ]);

    recommended.next();
    recommended.updateSelections({ mode: 'custom' });

    expect(recommended.getState().visibleSteps).toEqual([
      'welcome',
      'mode',
      'provider',
      'character',
      'voice',
      'speechInput',
      'review',
      'finish',
    ]);
    recommended.next();
    recommended.next();
    expect(recommended.getState().stepId).toBe('character');
  });

  it('reports the final page instead of offering another step', () => {
    const flow = new SetupFlow();
    flow.next();
    flow.next();
    flow.next();
    flow.next();

    expect(flow.getState()).toMatchObject({
      stepId: 'finish',
      canGoNext: false,
      isFinalStep: true,
      stepIndex: 4,
    });
    expect(flow.next()).toBe(false);
    expect(flow.getState().stepId).toBe('finish');
  });

  it('refuses to move back from the first page', () => {
    const flow = new SetupFlow();

    expect(flow.back()).toBe(false);
    expect(flow.getState().stepId).toBe('welcome');
  });

  it('preserves page selections when the user navigates backwards', () => {
    const flow = new SetupFlow();
    flow.next();
    flow.updateSelections({ mode: 'custom' });
    flow.next();
    flow.back();

    expect(flow.getState().selections).toEqual({
      mode: 'custom',
      characterSource: 'placeholder',
      launchAfterFinish: true,
      voice: 'none',
      speechInput: false,
    });
  });

  it('starts from the recommended defaults', () => {
    expect(new SetupFlow().getSelections()).toEqual(DEFAULT_SETUP_SELECTIONS);
    expect(DEFAULT_SETUP_SELECTIONS).toEqual({
      mode: 'recommended',
      characterSource: 'placeholder',
      launchAfterFinish: true,
      voice: 'none',
      speechInput: false,
    });
  });

  it('skips pages that the current selections make irrelevant', () => {
    const steps: SetupStepDefinition[] = [
      { id: 'welcome' },
      { id: 'mode' },
      { id: 'review', isEnabled: (selections) => selections.mode === 'custom' },
      { id: 'finish' },
    ];
    const flow = new SetupFlow(steps);
    flow.next();

    expect(flow.getState().visibleSteps).toEqual(['welcome', 'mode', 'finish']);
    flow.next();
    expect(flow.getState()).toMatchObject({ stepId: 'finish', stepIndex: 2, isFinalStep: true });
    flow.back();
    expect(flow.getState().stepId).toBe('mode');
  });

  it('re-includes a skipped page when the selection changes', () => {
    const steps: SetupStepDefinition[] = [
      { id: 'welcome' },
      { id: 'mode' },
      { id: 'review', isEnabled: (selections) => selections.mode === 'custom' },
      { id: 'finish' },
    ];
    const flow = new SetupFlow(steps);
    flow.next();
    flow.updateSelections({ mode: 'custom' });

    expect(flow.getState().visibleSteps).toEqual(['welcome', 'mode', 'review', 'finish']);
    flow.next();
    expect(flow.getState().stepId).toBe('review');
  });

  it('leaves a page that its own selection just disabled', () => {
    const steps: SetupStepDefinition[] = [
      { id: 'welcome' },
      { id: 'mode', isEnabled: (selections) => selections.mode === 'custom' },
      { id: 'finish' },
    ];
    const flow = new SetupFlow(steps, {
      mode: 'custom',
      characterSource: 'placeholder',
      launchAfterFinish: true,
      voice: 'none',
      speechInput: false,
    });
    flow.next();
    expect(flow.getState().stepId).toBe('mode');

    flow.updateSelections({ mode: 'recommended' });

    expect(flow.getState().stepId).toBe('welcome');
    expect(flow.getState().visibleSteps).toEqual(['welcome', 'finish']);
  });

  it('rejects an empty or repeated step list', () => {
    expect(() => new SetupFlow([])).toThrow();
    expect(() => new SetupFlow([{ id: 'welcome' }, { id: 'welcome' }])).toThrow();
  });

  it('exposes the pages this milestone implements', () => {
    expect(createDefaultSetupSteps().map((step) => step.id)).toEqual([
      'welcome',
      'mode',
      'provider',
      'character',
      'voice',
      'speechInput',
      'review',
      'resources',
      'finish',
    ]);
  });
});
