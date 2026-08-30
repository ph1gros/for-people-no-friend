import eslint from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.release/**',
      '.tmp-spout2/**',
      'assets/models/local/**',
      'coverage/**',
      'data/**',
      'dist/**',
      'dist-electron/**',
      'node_modules/**',
      'native/vtube-studio-spout/vendor/spout2/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
);
