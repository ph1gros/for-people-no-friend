import { access } from 'node:fs/promises';
import path from 'node:path';

import type { SetupState } from '../../shared/setup-ipc';

/**
 * Files written by the application before the Setup Wizard existed. Any of them means the
 * installation already reached a usable state, so an upgrading user must not be pushed
 * through first-run setup.
 */
export const EXISTING_INSTALLATION_MARKERS = Object.freeze([
  'model-providers.v1.json',
  'secrets.v1.json',
  'character-profiles.v5.json',
  'character-profiles.live2d.v1.json',
  'character-packages.v1.json',
  'live2d-models.v1.json',
  'speech.v1.json',
  'desktop-integrations.v1.json',
  'deskpet.v1.sqlite',
  'conversation.v1.json',
]);

export interface SetupLaunchDecision {
  /** Show the wizard before the normal application window. */
  runSetup: boolean;
  /** Persist completion for an installation that predates the wizard. */
  adoptExistingInstallation: boolean;
}

export const detectExistingInstallation = async (
  userDataPath: string,
  exists: (candidate: string) => Promise<boolean> = async (candidate) => {
    try {
      await access(candidate);
      return true;
    } catch {
      return false;
    }
  },
): Promise<boolean> => {
  for (const marker of EXISTING_INSTALLATION_MARKERS) {
    if (await exists(path.join(userDataPath, marker))) {
      return true;
    }
  }
  return false;
};

export const resolveSetupLaunchDecision = (input: {
  state: SetupState;
  hasExistingConfiguration: boolean;
}): SetupLaunchDecision => {
  if (input.state.completed) {
    return { runSetup: false, adoptExistingInstallation: false };
  }
  if (input.state.progress) return { runSetup: true, adoptExistingInstallation: false };
  if (input.hasExistingConfiguration) {
    return { runSetup: false, adoptExistingInstallation: true };
  }
  return { runSetup: true, adoptExistingInstallation: false };
};
