import { createSocket } from 'node:dgram';
import Opus from 'opusscript';
import { describe, expect, it, vi } from 'vitest';
import {
  createKookAudioSender,
  isPublicMediaAddress,
  makeRtpPacket,
} from '../src/adapters/social/kook/kook-rtp';
import { parseKookVoiceTransport } from '../src/adapters/social/kook/kook-voice';
import { encodeWavPcm16 } from '../src/core/social/social-voice';
import { parseKookVoiceInput } from '../src/shared/social-ipc';

const wav = (frames = 2400) =>
  encodeWavPcm16({
    sampleRate: 24000,
    samples: Int16Array.from({ length: frames }, (_, i) =>
      Math.round(Math.sin((i * Math.PI * 2 * 440) / 24000) * 16000),
    ),
  });

describe('KOOK Opus RTP output', () => {
  it('parses official decimal-string transport fields', () => {
    expect(
      parseKookVoiceTransport({
        ip: '8.8.8.8',
        port: '4000',
        rtcp_mux: true,
        audio_ssrc: '1111',
        audio_pt: '111',
        bitrate: 48000,
      }),
    ).toMatchObject({ port: 4000, audioSsrc: 1111, audioPt: 111 });
  });

  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '255.255.255.255',
    '224.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fe80::1',
    'fc00::1',
    'example.com',
    '::::',
  ])('rejects non-public UDP targets: %s', (ip) => {
    expect(isPublicMediaAddress(ip)).toBe(false);
  });

  it('encodes RTP headers including sequence/timestamp wrap', () => {
    const packet = makeRtpPacket(new Uint8Array([1, 2]), 65536, 0x100000001, 1234, 111, true);
    expect(packet[0]).toBe(128);
    expect(packet[1]).toBe(239);
    expect(packet.readUInt16BE(2)).toBe(0);
    expect(packet.readUInt32BE(4)).toBe(1);
    expect(packet.readUInt32BE(8)).toBe(1234);
    expect([...packet.subarray(12)]).toEqual([1, 2]);
  });

  it('sends real decodable Opus with pacing and reuses the UDP source port across clips', async () => {
    const receiver = createSocket('udp4');
    await new Promise<void>((resolve) => receiver.bind(0, '127.0.0.1', resolve));
    const packets: Array<{ data: Buffer; port: number; time: number }> = [];
    receiver.on('message', (data, peer) =>
      packets.push({ data, port: peer.port, time: performance.now() }),
    );
    const address = receiver.address();
    const sender = await createKookAudioSender(
      {
        ip: '127.0.0.1',
        port: address.port,
        rtcpMux: true,
        audioSsrc: 1111,
        audioPt: 111,
        bitrate: 48000,
      },
      { allowLoopbackForTests: true },
    );
    const decoder = new Opus(48000, 2, Opus.Application.AUDIO);
    try {
      await sender.play(wav(), new AbortController().signal);
      await sender.play(wav(240), new AbortController().signal);
      await vi.waitFor(() => expect(packets).toHaveLength(6));
      expect(new Set(packets.map((packet) => packet.port)).size).toBe(1);
      expect(packets[4]!.time - packets[0]!.time).toBeGreaterThanOrEqual(60);
      let energy = 0;
      for (let i = 0; i < packets.length; i++) {
        const packet = packets[i]!.data;
        expect(packet[1]! & 127).toBe(111);
        expect(packet.readUInt32BE(8)).toBe(1111);
        expect(!!(packet[1]! & 128)).toBe(i === 0 || i === 5);
        if (i > 0)
          expect(packet.readUInt16BE(2)).toBe((packets[i - 1]!.data.readUInt16BE(2) + 1) & 65535);
        if (i > 0 && i < 5)
          expect((packet.readUInt32BE(4) - packets[i - 1]!.data.readUInt32BE(4)) >>> 0).toBe(960);
        const pcm = decoder.decode(packet.subarray(12));
        expect(pcm.length).toBe(3840);
        for (let j = 0; j < pcm.length; j += 2) energy += Math.abs(pcm.readInt16LE(j));
      }
      expect(energy).toBeGreaterThan(100000);
      await vi.waitFor(() => expect(packets.some(({ data }) => data[1] === 200)).toBe(true), {
        timeout: 6500,
      });
      const report = packets.find(({ data }) => data[1] === 200)!.data;
      expect(report.length).toBe(64);
      expect(report.readUInt32BE(4)).toBe(1111);
      expect(report.readUInt32BE(20)).toBe(6);
      expect(report[29]).toBe(202);
      const abort = new AbortController();
      receiver.once('message', () => abort.abort());
      await expect(sender.play(wav(24000), abort.signal)).rejects.toThrow();
      await expect(sender.play(new Uint8Array(10), new AbortController().signal)).rejects.toThrow();
      sender.close();
      await expect(sender.play(wav(), new AbortController().signal)).rejects.toThrow();
    } finally {
      sender.close();
      decoder.delete();
      receiver.close();
    }
  }, 10000);

  it('validates bounded Main voice commands and strips unexpected fields', () => {
    expect(
      parseKookVoiceInput({
        characterId: 'character-a',
        action: 'join',
        channelId: '12345',
        ip: '127.0.0.1',
      }),
    ).toEqual({ characterId: 'character-a', action: 'join', channelId: '12345' });
    for (const value of [
      null,
      { characterId: '../x', action: 'leave' },
      { characterId: 'character-a', action: 'join', channelId: 'http://bad' },
      { characterId: 'character-a', action: 'speak', text: 'a'.repeat(1001) },
      { characterId: 'character-a', action: 'speak', text: ' ' },
    ])
      expect(() => parseKookVoiceInput(value)).toThrow();
  });
});
