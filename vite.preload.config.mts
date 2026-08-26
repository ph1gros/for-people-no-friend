import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist-electron/preload',
    emptyOutDir: false,
    target: 'node24',
    sourcemap: true,
    minify: false,
    lib: {
      entry: 'src/preload/index.ts',
      formats: ['cjs'],
      fileName: () => 'index.cjs',
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
});
