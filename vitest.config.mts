import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Windows hosted runners heavily contend on concurrent node:sqlite files.
    // Keep useful parallelism while allowing integration tests to finish under CI I/O latency.
    maxWorkers: 4,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
