import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  publicDir: '../../assets',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
});
