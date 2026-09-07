export const SETUP_STEP_IDS = [
  'welcome',
  'mode',
  'provider',
  'character',
  'voice',
  'speechInput',
  'review',
  'resources',
  'finish',
] as const;

export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

export const SETUP_MODES = ['recommended', 'custom'] as const;

export type SetupMode = (typeof SETUP_MODES)[number];

export const SETUP_CHARACTER_SOURCES = ['placeholder', 'package', 'live2d'] as const;

export type SetupCharacterSource = (typeof SETUP_CHARACTER_SOURCES)[number];
export const SETUP_VOICES = ['none', 'genie', 'ireina'] as const;
export type SetupVoice = (typeof SETUP_VOICES)[number];

export interface SetupSelections {
  mode: SetupMode;
  characterSource: SetupCharacterSource;
  launchAfterFinish: boolean;
  voice: SetupVoice;
  speechInput: boolean;
}

export const DEFAULT_SETUP_SELECTIONS: SetupSelections = Object.freeze({
  mode: 'recommended',
  characterSource: 'placeholder',
  launchAfterFinish: true,
  voice: 'none',
  speechInput: false,
});

/**
 * A wizard page. Later milestones add optional voice and speech-input pages; `isEnabled`
 * keeps those pages skippable instead of disabled.
 */
export interface SetupStepDefinition {
  id: SetupStepId;
  isEnabled?: (selections: SetupSelections) => boolean;
}

export interface SetupNavigationState {
  stepId: SetupStepId;
  stepIndex: number;
  visibleSteps: SetupStepId[];
  canGoBack: boolean;
  canGoNext: boolean;
  isFinalStep: boolean;
  selections: SetupSelections;
}

export const createDefaultSetupSteps = (): SetupStepDefinition[] => [
  { id: 'welcome' },
  { id: 'mode' },
  { id: 'provider' },
  // The recommended path keeps the neutral placeholder character and skips this page.
  { id: 'character', isEnabled: (selections) => selections.mode === 'custom' },
  { id: 'voice', isEnabled: (selections) => selections.mode === 'custom' },
  { id: 'speechInput', isEnabled: (selections) => selections.mode === 'custom' },
  { id: 'review' },
  { id: 'resources', isEnabled: (s) => s.voice !== 'none' || s.speechInput },
  { id: 'finish' },
];

const isStepEnabled = (step: SetupStepDefinition, selections: SetupSelections): boolean =>
  step.isEnabled ? step.isEnabled(selections) : true;

/**
 * Linear Back/Next wizard navigation over a fixed page list.
 *
 * The flow owns the authoritative step position and the collected selections so that the
 * renderer stays a presentation layer, and so that pages preserve their state when the user
 * navigates backwards.
 */
export class SetupFlow {
  private readonly steps: SetupStepDefinition[];
  private selections: SetupSelections;
  private index = 0;

  public constructor(
    steps: SetupStepDefinition[] = createDefaultSetupSteps(),
    selections: SetupSelections = DEFAULT_SETUP_SELECTIONS,
  ) {
    if (steps.length === 0) {
      throw new Error('A setup flow needs at least one step.');
    }
    const uniqueIds = new Set(steps.map((step) => step.id));
    if (uniqueIds.size !== steps.length) {
      throw new Error('A setup flow cannot repeat a step id.');
    }
    this.steps = [...steps];
    this.selections = { ...selections };
    if (!isStepEnabled(this.steps[0]!, this.selections)) {
      const firstEnabled = this.findEnabled(0, 1);
      if (firstEnabled === undefined) {
        throw new Error('A setup flow needs at least one reachable step.');
      }
      this.index = firstEnabled;
    }
  }

  public getSelections(): SetupSelections {
    return { ...this.selections };
  }

  public restore(stepId: SetupStepId): void {
    const index = this.steps.findIndex(
      (step) => step.id === stepId && isStepEnabled(step, this.selections),
    );
    this.index = index >= 0 ? index : 0;
  }

  /**
   * Stores the current page's choices. Unknown or partial values are merged so that a page
   * only submits the fields it owns.
   */
  public updateSelections(patch: Partial<SetupSelections>): SetupSelections {
    this.selections = { ...this.selections, ...patch };
    if (!isStepEnabled(this.steps[this.index]!, this.selections)) {
      const fallback = this.findEnabled(this.index, -1) ?? this.findEnabled(this.index, 1);
      if (fallback !== undefined) {
        this.index = fallback;
      }
    }
    return this.getSelections();
  }

  public next(): boolean {
    const target = this.findEnabled(this.index, 1);
    if (target === undefined) {
      return false;
    }
    this.index = target;
    return true;
  }

  public back(): boolean {
    const target = this.findEnabled(this.index, -1);
    if (target === undefined) {
      return false;
    }
    this.index = target;
    return true;
  }

  public getState(): SetupNavigationState {
    const visibleSteps = this.steps
      .filter((step) => isStepEnabled(step, this.selections))
      .map((step) => step.id);
    const stepId = this.steps[this.index]!.id;
    return {
      stepId,
      stepIndex: visibleSteps.indexOf(stepId),
      visibleSteps,
      canGoBack: this.findEnabled(this.index, -1) !== undefined,
      canGoNext: this.findEnabled(this.index, 1) !== undefined,
      isFinalStep: this.findEnabled(this.index, 1) === undefined,
      selections: this.getSelections(),
    };
  }

  private findEnabled(from: number, direction: 1 | -1): number | undefined {
    for (let cursor = from + direction; cursor >= 0 && cursor < this.steps.length;) {
      if (isStepEnabled(this.steps[cursor]!, this.selections)) {
        return cursor;
      }
      cursor += direction;
    }
    return undefined;
  }
}
