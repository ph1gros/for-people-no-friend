import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import type { Plugin } from 'vite';

const OUTPUT_PATH = 'runtime/cubism/live2dcubismcore.min.js';

// Build-time inputs only. No model manifest, Renderer request or download selects this file.
// The digest detects changes to the developer's local copy; it is not a publisher trust anchor.
export const localCubismCorePlugin = (input: { sourcePath: string; sha256: string }): Plugin => {
  let isBuild = false;
  const readCore = async (): Promise<Buffer> => {
    let content: Buffer;
    try {
      const stat = await lstat(input.sourcePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
        throw new Error('invalid local runtime file');
      }
      content = await readFile(input.sourcePath);
    } catch {
      throw new Error('本地 Cubism Core 缺失或不是受支持的普通文件。请核对本地运行时配置。');
    }
    if (createHash('sha256').update(content).digest('hex') !== input.sha256) {
      throw new Error('本地 Cubism Core 内容已变化。请先核对来源和版本，不要直接更新校验值。');
    }
    return content;
  };
  return {
    name: 'fpnf-local-cubism-core',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    async buildStart() {
      if (!isBuild) return;
      this.emitFile({ type: 'asset', fileName: OUTPUT_PATH, source: await readCore() });
    },
    async configureServer(server) {
      const content = await readCore();
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== `/${OUTPUT_PATH}`) return next();
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.statusCode = 405;
          response.end();
          return;
        }
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.end(request.method === 'HEAD' ? undefined : content);
      });
    },
  };
};
