import { describe, expect, it } from 'vitest';

import { parseSetupResourceControl, setupResourceIds } from '../src/shared/setup-resources';
import { RESOURCE_DEFINITIONS } from '../src/shared/resource-catalog';
import { DEFAULT_SETUP_SELECTIONS, type SetupSelections } from '../src/core/setup/setup-flow';

const withSelections = (patch: Partial<SetupSelections>): SetupSelections => ({
  ...DEFAULT_SETUP_SELECTIONS,
  ...patch,
});

describe('setup resource selection', () => {
  it('installs nothing when neither voice nor speech input is requested', () => {
    expect(setupResourceIds(DEFAULT_SETUP_SELECTIONS)).toEqual([]);
    expect(setupResourceIds(withSelections({ mode: 'custom' }))).toEqual([]);
  });

  it('resolves each voice engine together with its own dependencies', () => {
    expect(setupResourceIds(withSelections({ voice: 'genie' })).sort()).toEqual([
      'genie-data',
      'genie-tts',
      'voice-genie-mika',
    ]);
    expect(setupResourceIds(withSelections({ voice: 'ireina' })).sort()).toEqual([
      'bert-japanese',
      'voice-ireina',
      'voice-runtime',
    ]);
  });

  it('adds speech recognition independently of the voice choice', () => {
    expect(setupResourceIds(withSelections({ speechInput: true }))).toEqual(['speech-input']);
    expect(setupResourceIds(withSelections({ voice: 'genie', speechInput: true }))).toContain(
      'speech-input',
    );
  });

  it('terminates on the catalogue’s mutual dependencies without repeating an id', () => {
    // voice-runtime ⇄ bert-japanese and genie-tts ⇄ genie-data are cyclic in the catalogue.
    expect(RESOURCE_DEFINITIONS['bert-japanese'].dependencies).toContain('voice-runtime');
    expect(RESOURCE_DEFINITIONS['genie-data'].dependencies).toContain('genie-tts');

    const ids = setupResourceIds(withSelections({ voice: 'ireina', speechInput: true }));

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(4);
  });

  it('never selects a resource outside the fixed application-owned combinations', () => {
    const everything = setupResourceIds(withSelections({ voice: 'genie', speechInput: true }));

    for (const id of everything) {
      expect(RESOURCE_DEFINITIONS[id]).toBeDefined();
    }
    expect(everything).not.toContain('voice-runtime');
  });
});

describe('setup resource control validation', () => {
  it('accepts only the declared actions', () => {
    for (const action of ['start', 'pause', 'resume', 'skip'] as const) {
      expect(parseSetupResourceControl({ action, allowMetered: false })).toEqual({
        action,
        allowMetered: false,
      });
    }
  });

  it('rejects unknown actions, missing flags and smuggled fields', () => {
    expect(() => parseSetupResourceControl({ action: 'install', allowMetered: true })).toThrow();
    expect(() => parseSetupResourceControl({ action: 'start' })).toThrow();
    expect(() => parseSetupResourceControl({ action: 'start', allowMetered: 'yes' })).toThrow();
    expect(() =>
      parseSetupResourceControl({ action: 'start', allowMetered: true, tierId: 'voice-runtime' }),
    ).toThrow();
    expect(() => parseSetupResourceControl(undefined)).toThrow();
    expect(() => parseSetupResourceControl([{ action: 'start', allowMetered: true }])).toThrow();
  });
});
