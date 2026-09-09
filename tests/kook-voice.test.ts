import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KookAdapter } from '../src/adapters/social/kook/kook-adapter';
import { KookError, type KookHttp } from '../src/adapters/social/kook/kook-http';
import type { KookTransport } from '../src/adapters/social/kook/kook-transport';
import {
  KOOK_VOICE_KEEPALIVE_MS,
  KookVoiceChannel,
  parseKookVoiceTransport,
} from '../src/adapters/social/kook/kook-voice';
import type { SocialTarget } from '../src/core/social/social-contracts';

const joinResponse = (overrides: Record<string, unknown> = {}) => ({
  ip: '203.0.113.10',
  port: 40_000,
  rtcp_port: 40_001,
  rtcp_mux: true,
  audio_ssrc: 1_234_567,
  audio_pt: 111,
  bitrate: 64_000,
  ...overrides,
});

const voiceHarness = () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  let joinResult: unknown = joinResponse();
  let keepAliveFails = 0;
  const http = {
    request: vi.fn(async (_method: string, path: string, body: unknown) => {
      calls.push({ path, body });
      if (path === '/api/v3/voice/join') return joinResult;
      if (path === '/api/v3/voice/keep-alive' && keepAliveFails > 0) {
        keepAliveFails -= 1;
        throw new KookError('request');
      }
      return {};
    }),
  } as unknown as KookHttp;
  const dropped = vi.fn();
  const channel = new KookVoiceChannel(http, { onDropped: dropped });
  return {
    channel,
    http,
    calls,
    dropped,
    setJoinResult: (value: unknown) => {
      joinResult = value;
    },
    failKeepAlive: (times: number) => {
      keepAliveFails = times;
    },
    paths: () => calls.map(({ path }) => path),
  };
};

describe('KOOK voice transport parsing', () => {
  it('accepts a well formed join response and keeps the optional fields', () => {
    expect(parseKookVoiceTransport(joinResponse())).toEqual({
      ip: '203.0.113.10',
      port: 40_000,
      rtcpPort: 40_001,
      rtcpMux: true,
      audioSsrc: 1_234_567,
      audioPt: 111,
      bitrate: 64_000,
    });
  });

  it('accepts a minimal response and defaults rtcp multiplexing to off', () => {
    expect(parseKookVoiceTransport({ ip: '198.51.100.7', port: 1 })).toEqual({
      ip: '198.51.100.7',
      port: 1,
      rtcpMux: false,
    });
  });

  it('refuses a destination it could not safely send audio to', () => {
    for (const bad of [
      {},
      { ip: '', port: 40_000 },
      { ip: 'not-an-address', port: 40_000 },
      { ip: '203.0.113.999', port: 40_000 },
      { ip: '203.0.113.010', port: 40_000 },
      { ip: '203.0.113.10', port: 0 },
      { ip: '203.0.113.10', port: 70_000 },
      { ip: '203.0.113.10', port: 40_000.5 },
      { ip: '203.0.113.10' },
    ]) {
      expect(() => parseKookVoiceTransport(bad)).toThrow(KookError);
    }
  });

  it('refuses out-of-range optional fields rather than silently dropping them', () => {
    expect(() => parseKookVoiceTransport(joinResponse({ rtcp_port: 0 }))).toThrow(KookError);
    expect(() => parseKookVoiceTransport(joinResponse({ audio_pt: 200 }))).toThrow(KookError);
    expect(() => parseKookVoiceTransport(joinResponse({ audio_ssrc: -1 }))).toThrow(KookError);
    expect(() => parseKookVoiceTransport(joinResponse({ bitrate: 'high' }))).toThrow(KookError);
  });

  it('accepts an IPv6 destination', () => {
    expect(parseKookVoiceTransport({ ip: '2001:db8::1', port: 40_000 }).ip).toBe('2001:db8::1');
  });
});

describe('KOOK voice channel membership', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const live = (): AbortSignal => new AbortController().signal;

  it('joins a room and returns the transport the media milestone will need', async () => {
    const h = voiceHarness();

    const handle = await h.channel.join('channel-1', live());

    expect(handle.channelId).toBe('channel-1');
    expect(handle.transport.port).toBe(40_000);
    expect(h.calls[0]).toEqual({
      path: '/api/v3/voice/join',
      body: { channel_id: 'channel-1', rtcp_mux: true },
    });
    expect(h.channel.joined).toBe(true);
  });

  it('keeps the membership alive on a fixed cadence', async () => {
    const h = voiceHarness();
    await h.channel.join('channel-1', live());

    await vi.advanceTimersByTimeAsync(KOOK_VOICE_KEEPALIVE_MS * 3 + 100);

    const keepAlives = h.paths().filter((path) => path === '/api/v3/voice/keep-alive');
    expect(keepAlives).toHaveLength(3);
    expect(h.dropped).not.toHaveBeenCalled();
  });

  it('tolerates a single keep-alive failure', async () => {
    const h = voiceHarness();
    await h.channel.join('channel-1', live());
    h.failKeepAlive(1);

    await vi.advanceTimersByTimeAsync(KOOK_VOICE_KEEPALIVE_MS * 2 + 100);

    expect(h.dropped).not.toHaveBeenCalled();
    expect(h.channel.joined).toBe(true);
  });

  it('drops the membership after two consecutive keep-alive failures', async () => {
    const h = voiceHarness();
    await h.channel.join('channel-1', live());
    h.failKeepAlive(2);

    await vi.advanceTimersByTimeAsync(KOOK_VOICE_KEEPALIVE_MS * 2 + 100);

    expect(h.dropped).toHaveBeenCalledTimes(1);
    expect(h.channel.joined).toBe(false);

    // A dropped session must stop talking to the platform entirely.
    const before = h.calls.length;
    await vi.advanceTimersByTimeAsync(KOOK_VOICE_KEEPALIVE_MS * 2);
    expect(h.calls.length).toBe(before);
  });

  it('leaves explicitly and stops the keep-alive', async () => {
    const h = voiceHarness();
    const handle = await h.channel.join('channel-1', live());

    await handle.leave();

    expect(h.paths()).toContain('/api/v3/voice/leave');
    expect(h.channel.joined).toBe(false);

    const before = h.calls.length;
    await vi.advanceTimersByTimeAsync(KOOK_VOICE_KEEPALIVE_MS * 2);
    expect(h.calls.length).toBe(before);
  });

  it('is idempotent on leave and refuses a second join', async () => {
    const h = voiceHarness();
    const handle = await h.channel.join('channel-1', live());

    await handle.leave();
    await handle.leave();
    expect(h.paths().filter((path) => path === '/api/v3/voice/leave')).toHaveLength(1);

    await h.channel.join('channel-2', live());
    await expect(h.channel.join('channel-3', live())).rejects.toThrow(KookError);
  });

  it('refuses a malformed channel and a malformed join response', async () => {
    const h = voiceHarness();
    await expect(h.channel.join('bad channel', live())).rejects.toThrow(KookError);

    h.setJoinResult({ ip: 'nope', port: 1 });
    await expect(h.channel.join('channel-1', live())).rejects.toThrow(KookError);
    expect(h.channel.joined).toBe(false);
  });
});

const channelTarget: SocialTarget = {
  platform: 'kook',
  channelKind: 'channel',
  channelId: 'channel-9',
  serverId: 'guild-3',
};

const adapterHarness = (voiceChannelEnabled: boolean) => {
  let handlers: Parameters<KookTransport['start']>[1];
  const leave = vi.fn(async () => undefined);
  const transport: KookTransport = {
    start: vi.fn(async (_signal, callbacks) => {
      handlers = callbacks;
      callbacks.ready('kook-bot-id');
      callbacks.state('online');
    }),
    sendText: vi.fn(async () => ({ id: 'sent-1' })),
    joinVoice: vi.fn(async (channelId: string) => ({
      channelId,
      transport: { ip: '203.0.113.10', port: 40_000, rtcpMux: true },
      leave,
    })),
    stop: vi.fn(),
  };
  const adapter = new KookAdapter({
    getToken: async () => 'fake-kook-token-for-tests',
    createTransport: () => transport,
    voiceChannelEnabled,
  });
  return { adapter, transport, leave, signal: () => handlers };
};

describe('KOOK adapter voice channel', () => {
  it('declares the capability only when it was explicitly enabled', () => {
    expect(adapterHarness(false).adapter.capabilities.voiceChannel).toBe(false);
    expect(adapterHarness(true).adapter.capabilities.voiceChannel).toBe(true);
    // Entering a room is not the same as being able to speak in it.
    expect(adapterHarness(true).adapter.capabilities.audioMessage).toBe(false);
  });

  it('joins a server channel and exposes a session that can leave', async () => {
    const h = adapterHarness(true);
    await h.adapter.connect();

    const session = await h.adapter.joinVoice(channelTarget);

    expect(session.target).toEqual(channelTarget);
    expect(h.transport.joinVoice).toHaveBeenCalledWith('channel-9', expect.anything());
    await session.leave();
    expect(h.leave).toHaveBeenCalledTimes(1);
  });

  it('refuses when the capability is off, offline, or the target is not a server channel', async () => {
    const disabled = adapterHarness(false);
    await disabled.adapter.connect();
    await expect(disabled.adapter.joinVoice(channelTarget)).rejects.toThrow(
      'KOOK voice channel is unavailable.',
    );

    const offline = adapterHarness(true);
    await expect(offline.adapter.joinVoice(channelTarget)).rejects.toThrow(
      'KOOK voice channel is unavailable.',
    );

    const h = adapterHarness(true);
    await h.adapter.connect();
    await expect(
      h.adapter.joinVoice({ platform: 'kook', channelKind: 'direct', channelId: 'peer-1' }),
    ).rejects.toThrow('KOOK voice channel is unavailable.');
    expect(h.transport.joinVoice).not.toHaveBeenCalled();
  });

  it('sanitizes a join failure instead of leaking it', async () => {
    const h = adapterHarness(true);
    await h.adapter.connect();
    vi.mocked(h.transport.joinVoice).mockRejectedValueOnce(
      new Error('Authorization: Bot AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
    );

    await expect(h.adapter.joinVoice(channelTarget)).rejects.toThrow(
      'KOOK could not join the voice channel.',
    );
  });
});
