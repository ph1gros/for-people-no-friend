import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  build: {
    outDir: 'dist-electron/preload',
    emptyOutDir: false,
    target: 'node24',
    sourcemap: true,
    minify: false,
    lib: {
      entry: mode === 'resources' ? 'src/preload/resource-center.ts' : 'src/preload/index.ts',
      formats: ['cjs'],
      fileName: () => (mode === 'resources' ? 'resource-center.cjs' : 'index.cjs'),
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
}));
