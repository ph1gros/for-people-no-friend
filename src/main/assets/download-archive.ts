import { mkdir, open, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fetchSpeechAssetArchive } from '../speech/speech-asset-fetch';

/** Shared sequential transfer used by speech and declarative packages. Trust is checked by callers. */
export const downloadArchive = async (options: {
  partialPath: string;
  urls: readonly string[];
  bytes: number;
  signal: AbortSignal;
  fetch: typeof fetch;
  onProgress?: (downloaded: number) => void;
}): Promise<string> => {
  const { partialPath, urls, bytes, signal, fetch: fetcher } = options;
  await mkdir(path.dirname(partialPath), { recursive: true });
  let lastError: unknown;
  for (const source of urls) {
    try {
      signal.throwIfAborted();
      let offset = (await stat(partialPath).catch(() => undefined))?.size ?? 0;
      if (offset > bytes) {
        await rm(partialPath, { force: true });
        offset = 0;
      }
      if (offset === bytes) return partialPath;
      let response = await fetchSpeechAssetArchive(
        source,
        {
          headers: offset > 0 ? { range: `bytes=${offset}-` } : {},
          signal,
          credentials: 'omit',
        },
        fetcher,
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`资产下载失败（HTTP ${response.status}）。`);
      }
      if (offset > 0 && response.status === 200) {
        await response.body?.cancel();
        await rm(partialPath, { force: true });
        offset = 0;
        response = await fetchSpeechAssetArchive(source, { signal, credentials: 'omit' }, fetcher);
      }
      if (
        !response.body ||
        response.status !== (offset > 0 ? 206 : 200) ||
        (offset > 0 &&
          response.headers.get('content-range') !== `bytes ${offset}-${bytes - 1}/${bytes}`) ||
        (response.headers.has('content-length') &&
          Number(response.headers.get('content-length')) !== bytes - offset)
      ) {
        await response.body?.cancel();
        throw new Error('资产响应状态、分段或体积与内置记录不一致。');
      }
      const reader = response.body.getReader();
      const handle = await open(partialPath, offset > 0 ? 'a' : 'w');
      let downloaded = offset;
      try {
        while (true) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          downloaded += value.length;
          if (downloaded > bytes) throw new Error('资产下载体积超过应用内置记录。');
          let written = 0;
          while (written < value.length) {
            const result = await handle.write(value.subarray(written));
            if (result.bytesWritten === 0) throw new Error('资产写入未完成。');
            written += result.bytesWritten;
          }
          options.onProgress?.(downloaded);
        }
        signal.throwIfAborted();
        await handle.sync();
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
        await handle.close();
      }
      if (downloaded !== bytes) throw new Error('资产下载未完成，可稍后继续。');
      return partialPath;
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('所有资产下载源都不可用。');
};
