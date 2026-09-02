import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { argv, exit, stderr } from 'node:process';

import characterArchiveModule from '../dist-electron/main/character/character-package-archive.js';
import characterProfileModule from '../dist-electron/core/conversation/character-profile.js';

const { createCharacterPackageArchive } = characterArchiveModule;
const { KITTEN_CHARACTER_PROFILE } = characterProfileModule;

const outputPath = argv[2];
if (!outputPath || !path.isAbsolute(outputPath)) {
  throw new Error('Pass an absolute output path for the character package.');
}

const character = {
  ...KITTEN_CHARACTER_PROFILE,
  live2dModelId: 'no-model',
};
const manifest = {
  version: 1,
  packageId: 'fpnf-kitten-v1',
  character,
  assets: [],
  attribution: [
    {
      title: 'For People No Friend 小猫角色卡',
      url: 'https://github.com/ph1gros/for-people-no-friend',
      licenseNote: '仅限非商业用途；不得用于收费、盈利或变现用途。',
    },
  ],
  minimumAppVersion: '1.7.0',
};

void writeFile(outputPath, createCharacterPackageArchive(manifest, new Map())).catch((error) => {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  exit(1);
});
