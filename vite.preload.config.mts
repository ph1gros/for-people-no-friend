import { defineConfig } from 'vite';

// Each preload bundle is built on its own so that the sandboxed output stays self-contained:
// a shared chunk between the deskpet and setup bridges would reintroduce relative requires.
const PRELOAD_ENTRIES = {
  index: 'src/preload/index.ts',
  setup: 'src/preload/setup.ts',
} as const;

type PreloadEntryName = keyof typeof PRELOAD_ENTRIES;

const requestedEntry = process.env.FPNF_PRELOAD_ENTRY ?? 'index';
const entryName: PreloadEntryName =
  requestedEntry in PRELOAD_ENTRIES ? (requestedEntry as PreloadEntryName) : 'index';

export default defineConfig(({ mode }) => ({
  build: {
    outDir: 'dist-electron/preload',
    emptyOutDir: false,
    target: 'node24',
    sourcemap: true,
    minify: false,
    lib: {
      entry: mode === 'resources' ? 'src/preload/resource-center.ts' : PRELOAD_ENTRIES[entryName],
      formats: ['cjs'],
      fileName: () => (mode === 'resources' ? 'resource-center.cjs' : `${entryName}.cjs`),
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
}));
