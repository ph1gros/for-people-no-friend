import { isIP } from 'node:net';
import { createKookAudioSender, type KookAudioSender } from './kook-rtp';
import {
  KOOK_OPERATION_TIMEOUT_MS,
  KookError,
  KookHttp,
  assertKookActive,
  isKookId,
  kookDeadline,
  kookRecord,
} from './kook-http';

/**
 * Negotiated media parameters. The sender additionally rejects non-public UDP destinations.
 */
export interface KookVoiceTransport {
  ip: string;
  port: number;
  rtcpPort?: number;
  rtcpMux: boolean;
  audioSsrc?: number;
  audioPt?: number;
  bitrate?: number;
}

export interface KookVoiceHandle {
  readonly channelId: string;
  readonly transport: KookVoiceTransport;
  play?(wav: Uint8Array, signal: AbortSignal): Promise<void>;
  leave(): Promise<void>;
}

/** KOOK expects a keep-alive well inside its idle window; 30 s leaves room for one retry. */
export const KOOK_VOICE_KEEPALIVE_MS = 30_000;
export const KOOK_VOICE_MAX_KEEPALIVE_FAILURES = 2;

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/u;

const isRoutableHost = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 45) return false;
  if (IPV4.test(value)) {
    return value.split('.').every((part) => {
      const octet = Number(part);
      return Number.isInteger(octet) && octet >= 0 && octet <= 255 && String(octet) === part;
    });
  }
  return isIP(value) === 6;
};

const isPort = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65_535;

const optionalPositive = (value: unknown, maximum: number): number | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && /^(0|[1-9]\d{0,9})$/u.test(value)) value = Number(value);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > maximum) {
    throw new KookError('response');
  }
  return value;
};

/** The join response is untrusted: it becomes a network destination for the media milestone. */
export const parseKookVoiceTransport = (value: unknown): KookVoiceTransport => {
  const record = kookRecord(value);
  if (record.rtcp_mux !== undefined && typeof record.rtcp_mux !== 'boolean')
    throw new KookError('response');
  const port = optionalPositive(record.port, 65535);
  if (!isRoutableHost(record.ip) || !isPort(port)) throw new KookError('response');
  const transport: KookVoiceTransport = {
    ip: record.ip,
    port,
    rtcpMux: record.rtcp_mux === true,
  };
  if (record.rtcp_port !== undefined && record.rtcp_port !== null) {
    const rtcpPort = optionalPositive(record.rtcp_port, 65535);
    if (!isPort(rtcpPort)) throw new KookError('response');
    transport.rtcpPort = rtcpPort;
  }
  const ssrc = optionalPositive(record.audio_ssrc, 0xffff_ffff);
  if (ssrc !== undefined) transport.audioSsrc = ssrc;
  const payloadType = optionalPositive(record.audio_pt, 127);
  if (payloadType !== undefined) transport.audioPt = payloadType;
  const bitrate = optionalPositive(record.bitrate, 512_000);
  if (bitrate !== undefined) transport.bitrate = bitrate;
  return transport;
};

export interface KookVoiceOptions {
  /** Injected for tests; production uses the real timers. */
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
  onDropped?: () => void;
  createAudioSender?: typeof createKookAudioSender;
}

/**
 * Owns voice-room membership and a lazily created, persistent Opus/RTP sender.
 *
 * A keep-alive failure is retried once; a second consecutive failure drops the session rather than
 * leaving a half-dead membership that looks connected.
 */
export class KookVoiceChannel {
  private timer?: ReturnType<typeof setInterval>;
  private failures = 0;
  private channelId?: string;
  private left = false;
  private joining = false;
  private generation = 0;
  private audio?: KookAudioSender;
  private removeAbort?: () => void;
  private mediaPending = false;

  public constructor(
    private readonly http: KookHttp,
    private readonly options: KookVoiceOptions = {},
  ) {}

  public async join(channelId: string, signal: AbortSignal): Promise<KookVoiceHandle> {
    if (!isKookId(channelId)) throw new KookError('input');
    if (this.channelId || this.joining) throw new KookError('input');
    this.joining = true;
    const generation = this.generation;
    let joinedRemotely = false;
    const operation = kookDeadline(signal, KOOK_OPERATION_TIMEOUT_MS);
    try {
      assertKookActive(operation.signal);
      const response = await this.http.request(
        'POST',
        '/api/v3/voice/join',
        { channel_id: channelId, rtcp_mux: true },
        operation.signal,
      );
      joinedRemotely = true;
      const transport = parseKookVoiceTransport(response);
      assertKookActive(operation.signal);
      if (generation !== this.generation) throw new KookError('input');
      this.channelId = channelId;
      this.left = false;
      this.failures = 0;
      this.startKeepAlive(channelId);
      const aborted = (): void => {
        void this.leave();
      };
      signal.addEventListener('abort', aborted, { once: true });
      this.removeAbort = () => signal.removeEventListener('abort', aborted);
      return {
        channelId,
        transport,
        play: async (wav, playbackSignal) => {
          if (generation !== this.generation || this.mediaPending) throw new KookError('input');
          this.mediaPending = true;
          try {
            if (!this.audio) {
              const audio = await (this.options.createAudioSender ?? createKookAudioSender)(
                transport,
              );
              if (generation !== this.generation || signal.aborted) {
                audio.close();
                throw new KookError('input');
              }
              this.audio = audio;
            }
            await this.audio.play(wav, AbortSignal.any([signal, playbackSignal]));
          } finally {
            this.mediaPending = false;
          }
        },
        leave: () => (generation === this.generation ? this.leave() : Promise.resolve()),
      };
    } catch (error) {
      if (joinedRemotely) {
        void this.http
          .request(
            'POST',
            '/api/v3/voice/leave',
            { channel_id: channelId },
            AbortSignal.timeout(KOOK_OPERATION_TIMEOUT_MS),
          )
          .catch(() => undefined);
      }
      throw operation.error(error);
    } finally {
      this.joining = false;
      operation.dispose();
    }
  }

  public async leave(): Promise<void> {
    this.generation += 1;
    this.removeAbort?.();
    this.removeAbort = undefined;
    this.audio?.close();
    this.audio = undefined;
    const channelId = this.channelId;
    this.stopKeepAlive();
    this.channelId = undefined;
    if (!channelId || this.left) return;
    this.left = true;
    try {
      await this.http.request(
        'POST',
        '/api/v3/voice/leave',
        { channel_id: channelId },
        AbortSignal.timeout(KOOK_OPERATION_TIMEOUT_MS),
      );
    } catch {
      // Best effort: the platform drops an unmaintained membership on its own.
    }
  }

  public get joined(): boolean {
    return this.channelId !== undefined;
  }

  private startKeepAlive(channelId: string): void {
    const schedule = this.options.setInterval ?? setInterval;
    this.timer = schedule(() => {
      void this.keepAlive(channelId);
    }, KOOK_VOICE_KEEPALIVE_MS);
  }

  private stopKeepAlive(): void {
    if (!this.timer) return;
    const cancel = this.options.clearInterval ?? clearInterval;
    cancel(this.timer);
    this.timer = undefined;
  }

  private async keepAlive(channelId: string): Promise<void> {
    if (this.channelId !== channelId) return;
    const generation = this.generation;
    try {
      await this.http.request(
        'POST',
        '/api/v3/voice/keep-alive',
        { channel_id: channelId },
        AbortSignal.timeout(KOOK_OPERATION_TIMEOUT_MS),
      );
      if (generation === this.generation) this.failures = 0;
    } catch {
      if (generation !== this.generation) return;
      this.failures += 1;
      if (this.failures < KOOK_VOICE_MAX_KEEPALIVE_FAILURES) return;
      // Two consecutive failures: stop pretending the character is still in the room.
      if (this.channelId !== channelId) return;
      void this.leave();
      this.options.onDropped?.();
    }
  }
}
