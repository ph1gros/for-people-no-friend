import { describe, expect, it, vi } from 'vitest';
import { fetchSpeechAssetArchive } from '../src/main/speech/speech-asset-fetch';

const source =
  'https://github.com/ph1gros/fpnf-resources/releases/download/components-v1.8.0/genie-tts-1.0.1.zip';
describe('GitHub speech resource downloads', () => {
  it('follows one GitHub asset redirect while retaining the range and cancellation', async () => {
    const destination =
      'https://release-assets.githubusercontent.com/github-production-release-asset/fake?signature=fake';
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: destination } }),
      )
      .mockResolvedValueOnce(new Response('bytes', { status: 206 }));
    const init = { headers: { range: 'bytes=10-19' }, signal: new AbortController().signal };
    expect((await fetchSpeechAssetArchive(source, init, fetcher)).status).toBe(206);
    expect(fetcher).toHaveBeenNthCalledWith(1, source, { ...init, redirect: 'manual' });
    expect(fetcher).toHaveBeenNthCalledWith(2, destination, { ...init, redirect: 'error' });
  });
  it('rejects untrusted redirect destinations without sending another request', async () => {
    for (const location of [
      'http://release-assets.githubusercontent.com/a',
      'https://evil.example/a',
      'https://release-assets.githubusercontent.com.evil.example/a',
      'https://user:pass@release-assets.githubusercontent.com/a',
      'http://127.0.0.1/a',
    ]) {
      const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
      await expect(fetchSpeechAssetArchive(source, {}, fetcher)).rejects.toThrow('来源');
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });
  it('does not grant other sources redirect permission or permit a second redirect', async () => {
    const location = 'https://release-assets.githubusercontent.com/a';
    const other = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
    await expect(
      fetchSpeechAssetArchive('https://github.com/other/repo/releases/download/tag/a', {}, other),
    ).rejects.toThrow('跳转');
    expect(other).toHaveBeenCalledOnce();
    expect(other).toHaveBeenCalledWith(expect.any(String), { redirect: 'error' });
    const twice = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
    await expect(fetchSpeechAssetArchive(source, {}, twice)).rejects.toThrow('次数');
    expect(twice).toHaveBeenCalledTimes(2);
  });
});
