import { describe, expect, it, vi } from 'vitest';
import { fetchSpeechAssetManifest } from '../src/main/speech/speech-asset-downloader';

describe('speech manifest network limits', () => {
  it('stops a streaming oversized manifest even without Content-Length', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(128 * 1024));
      },
      cancel,
    });
    const fetcher = vi.fn(async () => new Response(stream));
    await expect(
      fetchSpeechAssetManifest('https://example.com/routes.json', { fetch: fetcher }),
    ).rejects.toThrow('过大');
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.com/routes.json',
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('cancels a declared oversized body before reading it', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    await expect(
      fetchSpeechAssetManifest('https://example.com/routes.json', {
        fetch: vi.fn(async () => new Response(stream, { headers: { 'Content-Length': '262145' } })),
      }),
    ).rejects.toThrow('过大');
    expect(cancel).toHaveBeenCalledOnce();
  });
});
