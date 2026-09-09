import { randomBytes } from 'node:crypto';
import { createSocket, type Socket } from 'node:dgram';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { parseWavPcm16, resamplePcm16 } from '../../../core/social/social-voice';
import type { KookVoiceTransport } from './kook-voice';

export interface KookAudioSender {
  play(wav: Uint8Array, signal: AbortSignal): Promise<void>;
  close(): void;
}

/** Only public, literal addresses supplied by the authenticated join response. No DNS. */
export function isPublicMediaAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a! >= 224 ||
      (a === 100 && b! >= 64 && b! <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  // Restrict IPv6 to global unicast; excludes mapped IPv4 and local/multicast addresses.
  return isIP(ip) === 6 && /^[23][0-9a-f]{3}:/iu.test(ip);
}

export function makeRtpPacket(
  payload: Uint8Array,
  sequence: number,
  timestamp: number,
  ssrc: number,
  payloadType: number,
  marker: boolean,
): Buffer {
  const packet = Buffer.alloc(12 + payload.byteLength);
  packet[0] = 0x80;
  packet[1] = payloadType | (marker ? 0x80 : 0);
  packet.writeUInt16BE(sequence & 0xffff, 2);
  packet.writeUInt32BE(timestamp >>> 0, 4);
  packet.writeUInt32BE(ssrc >>> 0, 8);
  packet.set(payload, 12);
  return packet;
}

/** Main-only test seam. Never supplied by IPC or stored settings. */
export interface KookRtpDependencies {
  allowLoopbackForTests?: boolean;
}

/** Lazy WASM loading keeps codec failure out of the text connection startup path. */
export async function createKookAudioSender(
  transport: KookVoiceTransport,
  dependencies: KookRtpDependencies = {},
): Promise<KookAudioSender> {
  const validInteger = (n: number | undefined, min: number, max: number): n is number =>
    n !== undefined && Number.isInteger(n) && n >= min && n <= max;
  if (
    !(
      isPublicMediaAddress(transport.ip) ||
      (dependencies.allowLoopbackForTests && transport.ip === '127.0.0.1')
    ) ||
    !validInteger(transport.port, 1, 65535) ||
    !validInteger(transport.audioSsrc, 0, 0xffffffff) ||
    !validInteger(transport.audioPt, 96, 127) ||
    !validInteger(transport.bitrate, isIP(transport.ip) === 6 ? 32000 : 24000, 512000) ||
    (!transport.rtcpMux && !validInteger(transport.rtcpPort, 1, 65535))
  )
    throw new Error('KOOK media configuration is invalid.');

  const { default: Opus } = await import('opusscript');
  const encoder = new Opus(48000, 2, Opus.Application.AUDIO);
  try {
    const overhead = isIP(transport.ip) === 6 ? 24000 : 16000;
    encoder.setBitrate(Math.min(128000, Math.max(6000, transport.bitrate - overhead)));
    encoder.encoderCTL(4006, 0); // CBR: never let variable-rate bursts exceed the server ceiling.
  } catch {
    encoder.delete();
    throw new Error('KOOK audio encoder is unavailable.');
  }
  const socket: Socket = createSocket(isIP(transport.ip) === 6 ? 'udp6' : 'udp4');
  const lifetime = new AbortController();
  const rtcp = transport.rtcpMux
    ? socket
    : createSocket(isIP(transport.ip) === 6 ? 'udp6' : 'udp4');
  let reportTimer: ReturnType<typeof setInterval> | undefined;
  let packetCount = 0;
  let octetCount = 0;
  let lastSentTime = performance.now();
  let lastSentTimestamp = 0;
  const cname = randomBytes(12).toString('hex');
  let closed = false;
  let busy = false;
  let sequence = randomBytes(2).readUInt16BE();
  let timestamp = randomBytes(4).readUInt32BE();
  let lastEnd = performance.now();
  const close = (): void => {
    if (closed) return;
    closed = true;
    lifetime.abort();
    clearInterval(reportTimer);
    reportTimer = undefined;
    try {
      socket.close();
    } catch {
      /* Socket might not have bound yet. */
    }
    encoder.delete();
    if (rtcp !== socket) {
      try {
        rtcp.close();
      } catch {
        /* Not yet bound. */
      }
    }
  };
  socket.on('error', close);
  if (rtcp !== socket) rtcp.on('error', close);
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.connect(transport.port, transport.ip, () => {
        socket.removeListener('error', reject);
        resolve();
      });
    });
  } catch {
    close();
    throw new Error('KOOK media connection failed.');
  }
  // Compound SR + SDES every five seconds, including idle time after the first clip.
  // With RTCP multiplexing this also keeps the media socket's NAT mapping alive.
  reportTimer = setInterval(() => {
    if (closed || packetCount === 0) return;
    const packet = Buffer.alloc(64); // 28-byte SR + 36-byte SDES (24-byte random CNAME).
    packet[0] = 0x80;
    packet[1] = 200;
    packet.writeUInt16BE(6, 2);
    packet.writeUInt32BE(transport.audioSsrc!, 4);
    const now = Date.now();
    packet.writeUInt32BE((Math.floor(now / 1000) + 2208988800) >>> 0, 8);
    packet.writeUInt32BE(Math.floor(((now % 1000) / 1000) * 0x100000000), 12);
    packet.writeUInt32BE(
      (lastSentTimestamp + Math.round((performance.now() - lastSentTime) * 48)) >>> 0,
      16,
    );
    packet.writeUInt32BE(packetCount >>> 0, 20);
    packet.writeUInt32BE(octetCount >>> 0, 24);
    packet[28] = 0x81;
    packet[29] = 202;
    packet.writeUInt16BE(8, 30);
    packet.writeUInt32BE(transport.audioSsrc!, 32);
    packet[36] = 1;
    packet[37] = cname.length;
    packet.write(cname, 38, 'ascii');
    const sent = (error: Error | null): void => {
      if (error) close();
    };
    if (rtcp === socket) rtcp.send(packet, sent);
    else rtcp.send(packet, transport.rtcpPort!, transport.ip, sent);
  }, 5000);
  reportTimer.unref();
  return {
    close,
    async play(wav, signal) {
      if (closed || busy || signal.aborted) throw new Error('KOOK media is unavailable.');
      if (!(wav instanceof Uint8Array) || wav.byteLength > 8 * 1024 * 1024) {
        throw new Error('KOOK audio is invalid.');
      }
      const decoded = parseWavPcm16(wav);
      if (!decoded.samples.length || decoded.samples.length / decoded.sampleRate > 60) {
        throw new Error('KOOK audio duration is invalid.');
      }
      const audio = resamplePcm16(decoded, 48000);
      const active = AbortSignal.any([signal, lifetime.signal]);
      busy = true;
      timestamp = (timestamp + Math.max(0, Math.round((performance.now() - lastEnd) * 48))) >>> 0;
      let deadline = performance.now();
      try {
        for (let offset = 0; offset < audio.samples.length; offset += 960) {
          await delay(Math.max(0, deadline - performance.now()), undefined, { signal: active });
          active.throwIfAborted();
          const frame = Buffer.alloc(960 * 4);
          for (let i = 0; i < 960; i++) {
            const sample = audio.samples[offset + i] ?? 0;
            frame.writeInt16LE(sample, i * 4);
            frame.writeInt16LE(sample, i * 4 + 2);
          }
          const payload = encoder.encode(frame, 960);
          if (payload.length > 1188) throw new Error('KOOK audio packet exceeds its limit.');
          const packet = makeRtpPacket(
            payload,
            sequence,
            timestamp,
            transport.audioSsrc!,
            transport.audioPt!,
            offset === 0,
          );
          await new Promise<void>((resolve, reject) =>
            socket.send(packet, (error) => (error ? reject(error) : resolve())),
          );
          packetCount += 1;
          octetCount += payload.length;
          lastSentTime = performance.now();
          lastSentTimestamp = timestamp;
          sequence = (sequence + 1) & 0xffff;
          timestamp = (timestamp + 960) >>> 0;
          // Re-anchor late frames instead of emitting a catch-up burst.
          deadline = Math.max(deadline + 20, performance.now() + 20);
        }
        await delay(Math.max(0, deadline - performance.now()), undefined, { signal: active });
      } catch {
        if (!signal.aborted) close();
        throw new Error('KOOK audio playback stopped.');
      } finally {
        busy = false;
        lastEnd = performance.now();
      }
    },
  };
}
