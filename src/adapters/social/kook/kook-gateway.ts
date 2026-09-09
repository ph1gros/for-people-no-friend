import WebSocket, { type ClientOptions } from 'ws';

import { KookError, KookHttp, KOOK_MAX_PAYLOAD_BYTES, isKookId, kookRecord } from './kook-http';

export type KookSocket = Pick<WebSocket, 'on' | 'off' | 'send' | 'terminate' | 'readyState'>;
export type KookWebSocketFactory = (url: string, options: ClientOptions) => KookSocket;

export interface KookGatewayHandlers {
  ready: (selfUserId: string) => void;
  message: (value: unknown) => void;
  state: (state: 'connecting' | 'online' | 'offline' | 'error') => void;
}

/** Gateway signalling opcodes. */
const OP_EVENT = 0;
const OP_HELLO = 1;
const OP_PING = 2;
const OP_PONG = 3;
const OP_RECONNECT = 5;
const OP_RESUME_ACK = 6;

export const KOOK_HANDSHAKE_TIMEOUT_MS = 10_000;
export const KOOK_HEARTBEAT_INTERVAL_MS = 30_000;
export const KOOK_HEARTBEAT_TIMEOUT_MS = 6_000;
export const KOOK_MAX_MISSED_HEARTBEATS = 2;
export const KOOK_RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
const MAX_FRAME_BYTES = 512 * 1_024;

const GATEWAY_HOST_SUFFIX = '.kookapp.cn';
const GATEWAY_HOSTS = new Set(['kookapp.cn', 'www.kookapp.cn']);

/**
 * The gateway URL comes from the API response, which is still untrusted input: only a KOOK host
 * over wss is accepted, and no credentials may be smuggled in the authority.
 */
export const validateKookGatewayUrl = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/u.test(value)) {
    throw new KookError('response');
  }
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== 'wss:' ||
      !(GATEWAY_HOSTS.has(host) || host.endsWith(GATEWAY_HOST_SUFFIX)) ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port && url.port !== '443')
    ) {
      throw new KookError('response');
    }
    return url.href;
  } catch (error) {
    throw error instanceof KookError ? error : new KookError('response');
  }
};

const decodeFrame = (data: unknown): Record<string, unknown> | undefined => {
  let text: string | undefined;
  if (typeof data === 'string') text = data;
  else if (data instanceof ArrayBuffer) {
    if (data.byteLength > MAX_FRAME_BYTES) return undefined;
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } else if (ArrayBuffer.isView(data)) {
    if (data.byteLength > MAX_FRAME_BYTES) return undefined;
    text = new TextDecoder('utf-8', { fatal: true }).decode(data as Uint8Array);
  }
  if (text === undefined || text.length > MAX_FRAME_BYTES) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * KOOK gateway session: handshake, heartbeat, sequence tracking, resume and backoff reconnect.
 * Owns no credentials of its own; every HTTP call is delegated to `KookHttp`.
 */
export class KookGateway {
  private socket?: KookSocket;
  private handlers?: KookGatewayHandlers;
  private lifetime?: AbortController;
  private sessionId?: string;
  private sequence = 0;
  private missedHeartbeats = 0;
  private attempt = 0;
  private heartbeatTimer?: ReturnType<typeof setTimeout>;
  private heartbeatDeadline?: ReturnType<typeof setTimeout>;
  private handshakeTimer?: ReturnType<typeof setTimeout>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private selfUserId = '';
  private stopped = false;
  private ready = false;

  public constructor(
    private readonly http: KookHttp,
    private readonly webSocketFactory: KookWebSocketFactory = (url, options) =>
      new WebSocket(url, options),
  ) {}

  public async start(signal: AbortSignal, handlers: KookGatewayHandlers): Promise<void> {
    if (this.stopped) throw new KookError('cancelled');
    this.handlers = handlers;
    this.lifetime = new AbortController();
    const onAbort = (): void => this.stop();
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      this.stop();
      throw new KookError('cancelled');
    }
    this.selfUserId = await this.resolveSelfUserId();
    await this.open();
  }

  public stop(): void {
    this.stopped = true;
    this.ready = false;
    this.clearTimers();
    this.lifetime?.abort();
    const socket = this.socket;
    this.socket = undefined;
    socket?.terminate();
    this.handlers?.state('offline');
  }

  private async resolveSelfUserId(): Promise<string> {
    const signal = this.lifetime?.signal ?? new AbortController().signal;
    const me = kookRecord(await this.http.request('GET', '/api/v3/user/me', undefined, signal));
    if (!isKookId(me.id)) throw new KookError('response');
    return me.id;
  }

  private async open(): Promise<void> {
    if (this.stopped) return;
    this.handlers?.state('connecting');
    const signal = this.lifetime?.signal ?? new AbortController().signal;
    const gateway = kookRecord(
      await this.http.request('GET', '/api/v3/gateway/index', undefined, signal, {
        compress: '0',
      }),
    );
    const base = validateKookGatewayUrl(gateway.url);
    // Resuming replays only what this session missed; a fresh session starts the sequence over.
    const url = new URL(base);
    if (this.sessionId && this.sequence > 0) {
      url.searchParams.set('resume', '1');
      url.searchParams.set('sn', String(this.sequence));
      url.searchParams.set('session_id', this.sessionId);
    }

    const socket = this.webSocketFactory(url.href, { maxPayload: KOOK_MAX_PAYLOAD_BYTES });
    this.socket = socket;
    socket.on('message', (data: unknown) => this.receive(data));
    socket.on('close', () => this.onDisconnected());
    socket.on('error', () => this.onDisconnected());
    this.handshakeTimer = setTimeout(() => {
      if (!this.ready) this.onDisconnected();
    }, KOOK_HANDSHAKE_TIMEOUT_MS);
  }

  private receive(data: unknown): void {
    const frame = decodeFrame(data);
    if (!frame) return;
    switch (frame.s) {
      case OP_HELLO: {
        const payload = kookRecord(frame.d);
        if (payload.code !== 0 || !isKookId(payload.session_id)) {
          this.onDisconnected();
          return;
        }
        this.sessionId = payload.session_id;
        this.onConnected();
        return;
      }
      case OP_RESUME_ACK: {
        const payload = kookRecord(frame.d);
        if (isKookId(payload.session_id)) this.sessionId = payload.session_id;
        this.onConnected();
        return;
      }
      case OP_EVENT: {
        // Out-of-order or replayed frames are dropped; the sequence only moves forward.
        if (
          typeof frame.sn !== 'number' ||
          !Number.isInteger(frame.sn) ||
          frame.sn <= this.sequence
        )
          return;
        this.sequence = frame.sn;
        this.handlers?.message(frame.d);
        return;
      }
      case OP_PONG: {
        this.missedHeartbeats = 0;
        this.clearHeartbeatDeadline();
        return;
      }
      case OP_RECONNECT: {
        // The platform asks for a clean session: the buffered sequence is no longer valid.
        this.sessionId = undefined;
        this.sequence = 0;
        this.onDisconnected();
        return;
      }
      default:
        return;
    }
  }

  private onConnected(): void {
    if (this.stopped) return;
    this.ready = true;
    this.attempt = 0;
    this.missedHeartbeats = 0;
    this.clearHandshakeTimer();
    this.handlers?.state('online');
    this.handlers?.ready(this.selfUserId);
    this.scheduleHeartbeat();
  }

  private scheduleHeartbeat(): void {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setTimeout(() => this.sendHeartbeat(), KOOK_HEARTBEAT_INTERVAL_MS);
  }

  private sendHeartbeat(): void {
    if (this.stopped || !this.socket) return;
    try {
      this.socket.send(JSON.stringify({ s: OP_PING, sn: this.sequence }));
    } catch {
      this.onDisconnected();
      return;
    }
    this.clearHeartbeatDeadline();
    this.heartbeatDeadline = setTimeout(() => {
      this.missedHeartbeats += 1;
      if (this.missedHeartbeats >= KOOK_MAX_MISSED_HEARTBEATS) this.onDisconnected();
      else this.sendHeartbeat();
    }, KOOK_HEARTBEAT_TIMEOUT_MS);
    this.scheduleHeartbeat();
  }

  private onDisconnected(): void {
    if (this.stopped) return;
    this.ready = false;
    this.clearTimers();
    const socket = this.socket;
    this.socket = undefined;
    socket?.terminate();
    this.handlers?.state('connecting');

    const delay =
      KOOK_RECONNECT_DELAYS_MS[Math.min(this.attempt, KOOK_RECONNECT_DELAYS_MS.length - 1)] ??
      30_000;
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      void this.open().catch(() => {
        this.handlers?.state('error');
        this.onDisconnected();
      });
    }, delay);
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = undefined;
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private clearHeartbeatDeadline(): void {
    if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline);
    this.heartbeatDeadline = undefined;
  }

  private clearTimers(): void {
    this.clearHandshakeTimer();
    this.clearHeartbeatTimer();
    this.clearHeartbeatDeadline();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
}
