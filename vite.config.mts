import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import { localCubismCorePlugin } from './scripts/local-cubism-core-plugin';

export default defineConfig(({ mode }) => ({
  root: 'src/renderer',
  base: './',
  // Runtime models are loaded from the validated character-package store. Never copy the
  // developer/private assets tree into a renderer build as an implicit side effect.
  publicDir: false,
  plugins: [
    // Explicit local-only mode: never re-enable copying the developer's entire assets tree.
    ...(mode === 'local-core'
      ? [
          localCubismCorePlugin({
            sourcePath: fileURLToPath(
              new URL('assets/models/local/live2dcubismcore.min.js', import.meta.url),
            ),
            sha256: '8741f739779b5d5210872bd3d7d99f0f1e56e6c87409e7d26d6bb4b80aa1ef47',
          }),
        ]
      : []),
    {
      name: 'fpnf-development-csp',
      transformIndexHtml(html, context) {
        if (!context.server) return html;
        // Every page needs the dev server's HMR socket, including the ones whose production
        // policy forbids network access entirely. Only the served HTML is widened; the files
        // on disk, and therefore the packaged build, keep their strict policy.
        return html
          .replace(
            "connect-src 'self' deskpet-model:;",
            "connect-src 'self' deskpet-model: ws://127.0.0.1:5173;",
          )
          .replace("connect-src 'none';", 'connect-src ws://127.0.0.1:5173;');
      },
    },
  ],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('src/renderer/index.html', import.meta.url)),
        resources: fileURLToPath(new URL('src/renderer/resource-center.html', import.meta.url)),
        setup: fileURLToPath(new URL('src/renderer/setup/index.html', import.meta.url)),
      },
    },
  },
}));
