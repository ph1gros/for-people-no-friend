import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  // Runtime models are loaded from the validated character-package store. Never copy the
  // developer/private assets tree into a renderer build as an implicit side effect.
  publicDir: false,
  plugins: [
    {
      name: 'fpnf-development-csp',
      transformIndexHtml(html, context) {
        if (!context.server) return html;
        return html.replace(
          "connect-src 'self' deskpet-model:;",
          "connect-src 'self' deskpet-model: ws://127.0.0.1:5173;",
        );
      },
    },
  ],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'src/renderer/index.html',
        resources: 'src/renderer/resource-center.html',
      },
    },
  },
});
