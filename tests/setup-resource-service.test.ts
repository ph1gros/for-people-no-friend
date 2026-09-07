import { describe, expect, it, vi } from 'vitest';

import { SetupResourceService } from '../src/main/setup/setup-resource-service';
import { SPEECH_ASSET_INTEGRITY } from '../src/main/speech/speech-asset-integrity';
import { DEFAULT_SETUP_SELECTIONS, type SetupSelections } from '../src/core/setup/setup-flow';
import type {
  SpeechAssetDownloadStatus,
  SpeechAssetTierId,
  SpeechAssetTierStatus,
} from '../src/shared/speech-asset-ipc';

const tier = (
  id: SpeechAssetTierId,
  state: SpeechAssetTierStatus['state'] = 'pending',
): SpeechAssetTierStatus => ({
  id,
  version: '1.0.0',
  state,
  downloadedBytes: 0,
  totalBytes: 1,
});

const GENIE_TIERS: SpeechAssetTierId[] = ['genie-tts', 'genie-data', 'voice-genie-mika'];

const createService = (
  options: {
    tiers?: SpeechAssetTierStatus[];
    metered?: boolean;
    settings?: Record<string, unknown>;
  } = {},
): {
  service: SetupResourceService;
  controls: Array<{ input: unknown; options: unknown }>;
  saved: Record<string, unknown>[];
} => {
  const downloads: SpeechAssetDownloadStatus = {
    sourceConfigured: true,
    metered: options.metered ?? false,
    busy: false,
    tiers: options.tiers ?? GENIE_TIERS.map((id) => tier(id)),
  };
  const controls: Array<{ input: unknown; options: unknown }> = [];
  const saved: Record<string, unknown>[] = [];
  const service = new SetupResourceService(
    { getStatus: async () => ({ catalog: { resources: [] }, downloads }) } as never,
    {
      control: async (input: unknown, controlOptions: unknown) => {
        controls.push({ input, options: controlOptions });
      },
    } as never,
    {
      get: async () => ({ ...(options.settings ?? {}) }),
      set: async (next: Record<string, unknown>) => {
        saved.push(next);
      },
    } as never,
  );
  return { service, controls, saved };
};

const genie = (): SetupSelections => ({
  ...DEFAULT_SETUP_SELECTIONS,
  mode: 'custom',
  voice: 'genie',
});

describe('setup resource status', () => {
  it('reports sizes from the main-process integrity record, not the remote catalogue', async () => {
    const { service } = createService();

    const status = await service.getStatus();
    const entry = status.resources.find((resource) => resource.id === 'genie-tts');
    const pinned = SPEECH_ASSET_INTEGRITY['genie-tts'];

    expect(entry?.downloadBytes).toBe(pinned?.compressedBytes);
    expect(entry?.installedBytes).toBe(pinned?.extractedBytes);
  });

  it('marks a resource unavailable when the downloader offers no matching tier', async () => {
    const { service } = createService({ tiers: [tier('genie-tts')] });

    const status = await service.getStatus();

    expect(status.resources.find((resource) => resource.id === 'genie-tts')?.available).toBe(true);
    expect(status.resources.find((resource) => resource.id === 'genie-data')?.available).toBe(
      false,
    );
  });
});

describe('setup resource control', () => {
  it('starts every resource the selection resolves to', async () => {
    const { service, controls } = createService();

    await service.control(
      genie(),
      { action: 'start', allowMetered: false },
      AbortSignal.timeout(5_000),
    );

    expect(controls).toHaveLength(3);
    expect(controls.map((call) => (call.input as { tierId: string }).tierId).sort()).toEqual([
      'genie-data',
      'genie-tts',
      'voice-genie-mika',
    ]);
    expect(controls[0]?.input).toMatchObject({ action: 'start' });
  });

  it('refuses to start when a selected component has no download available', async () => {
    const { service, controls } = createService({ tiers: [tier('genie-tts')] });

    await expect(
      service.control(
        genie(),
        { action: 'start', allowMetered: false },
        AbortSignal.timeout(5_000),
      ),
    ).rejects.toThrow(/暂不可下载/u);
    expect(controls).toHaveLength(0);
  });

  it('skips a component that already passed verification', async () => {
    const { service, controls } = createService({
      tiers: [tier('genie-tts', 'ready'), tier('genie-data'), tier('voice-genie-mika')],
    });

    await service.control(
      genie(),
      { action: 'start', allowMetered: false },
      AbortSignal.timeout(5_000),
    );

    expect(controls.map((call) => (call.input as { tierId: string }).tierId)).not.toContain(
      'genie-tts',
    );
    expect(controls).toHaveLength(2);
  });

  it('pauses only what is actually downloading', async () => {
    const { service, controls } = createService({
      tiers: [
        tier('genie-tts', 'downloading'),
        tier('genie-data', 'pending'),
        tier('voice-genie-mika', 'ready'),
      ],
    });

    await service.control(
      genie(),
      { action: 'pause', allowMetered: false },
      AbortSignal.timeout(5_000),
    );

    expect(controls).toHaveLength(1);
    expect(controls[0]?.input).toEqual({ tierId: 'genie-tts', action: 'pause' });
  });

  it('forwards the explicit metered consent to the downloader', async () => {
    const { service, controls } = createService({ metered: true });

    await service.control(
      genie(),
      { action: 'resume', allowMetered: true },
      AbortSignal.timeout(5_000),
    );

    expect(controls[0]?.options).toMatchObject({ allowMetered: true });
    expect(controls[0]?.input).toMatchObject({ action: 'resume' });
  });

  it('does nothing when the selection needs no resource', async () => {
    const { service, controls } = createService();

    await service.control(
      DEFAULT_SETUP_SELECTIONS,
      { action: 'start', allowMetered: false },
      AbortSignal.timeout(5_000),
    );

    expect(controls).toHaveLength(0);
  });

  it('stops on an aborted signal instead of continuing the queue', async () => {
    const { service, controls } = createService();
    const controller = new AbortController();
    controller.abort();

    await expect(
      service.control(genie(), { action: 'start', allowMetered: false }, controller.signal),
    ).rejects.toThrow();
    expect(controls).toHaveLength(0);
  });
});

describe('setup resource activation', () => {
  it('refuses to enable speech before every component is verified', async () => {
    const { service, saved } = createService({
      tiers: [tier('genie-tts', 'ready'), tier('genie-data', 'ready'), tier('voice-genie-mika')],
    });

    await expect(service.requireReady(genie())).rejects.toThrow(/尚未通过完整校验/u);
    await expect(service.apply(genie(), AbortSignal.timeout(5_000))).rejects.toThrow();
    expect(saved).toHaveLength(0);
  });

  it('enables the matching preset once every component is ready', async () => {
    const { service, saved } = createService({
      tiers: GENIE_TIERS.map((id) => tier(id, 'ready')),
      settings: { enabled: false, inputEnabled: false },
    });

    await service.apply(genie(), AbortSignal.timeout(5_000));

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ enabled: true });
    expect(saved[0]?.inputEnabled).toBe(false);
  });

  it('enables manual speech input on a local loopback endpoint', async () => {
    const { service, saved } = createService({
      tiers: [tier('speech-input', 'ready')],
      settings: { enabled: false, inputEnabled: false },
    });

    await service.apply(
      { ...DEFAULT_SETUP_SELECTIONS, mode: 'custom', speechInput: true },
      AbortSignal.timeout(5_000),
    );

    expect(saved[0]).toMatchObject({ inputEnabled: true, inputMode: 'manual' });
    expect(String(saved[0]?.transcriptionBaseUrl)).toMatch(/^http:\/\/127\.0\.0\.1:/u);
  });

  it('writes nothing when the user installed no component', async () => {
    const { service, saved } = createService();
    const settings = vi.fn();

    await service.apply(DEFAULT_SETUP_SELECTIONS, AbortSignal.timeout(5_000));

    expect(saved).toHaveLength(0);
    expect(settings).not.toHaveBeenCalled();
  });
});
