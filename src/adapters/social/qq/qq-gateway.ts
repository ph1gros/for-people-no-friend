import WebSocket, { type ClientOptions } from 'ws';
import { isQqId, QqError, QqHttp, QQ_MAX_PAYLOAD_BYTES, qqRecord } from './qq-http';

// SDK 1.0.4 is import-only ESM. A value-position dynamic import resolves the module in import
// mode without an import attribute, which the test transformer and the linter cannot parse.
export const importQqProtocol = () => import('@tencent-connect/qqbot-nodejs/protocol');

export type QqProtocol = Awaited<ReturnType<typeof importQqProtocol>>;
export type QqSocket = Pick<WebSocket, 'on' | 'off' | 'send' | 'terminate' | 'readyState'>;
export type QqWebSocketFactory = (url: string, options: ClientOptions) => QqSocket;
export interface QqGatewayHandlers {
  ready: (selfUserId: string) => void;
  message: (value: unknown) => void;
  state: (state: 'connecting' | 'online' | 'offline' | 'error') => void;
}

export const QQ_HANDSHAKE_TIMEOUT_MS = 10_000;
export const QQ_READY_TIMEOUT_MS = 15_000;
export const QQ_START_TIMEOUT_MS = 90_000;
export const QQ_MESSAGE_INTENT = 1 << 25;
const GATEWAY_HOSTS = new Set([
  'api.sgroup.qq.com',
  'sandbox.api.sgroup.qq.com',
  'wss.sgroup.qq.com',
]);

export function validateQqGatewayUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/u.test(value)) {
    throw new QqError('response');
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'wss:' ||
      !GATEWAY_HOSTS.has(url.hostname) ||
      url.username ||
      url.password ||
      url.hash ||
      (url.port && url.port !== '443')
    )
      throw new QqError('response');
    return url.href;
  } catch {
    throw new QqError('response');
  }
}

function notify<T>(handler: ((value: T) => void) | undefined, value: T): void {
  try {
    void Promise.resolve(handler?.(value)).catch(() => {});
  } catch {
    // Adapter exceptions must not become uncaught EventEmitter errors or disclose message data.
  }
}

function readFrame(data: unknown, isBinary: boolean): Record<string, unknown> {
  if (isBinary) throw new QqError('response');
  let bytes: Buffer;
  if (typeof data === 'string') {
    if (Buffer.byteLength(data) > QQ_MAX_PAYLOAD_BYTES) throw new QqError('size');
    bytes = Buffer.from(data);
  } else if (Buffer.isBuffer(data)) bytes = data;
  else if (data instanceof ArrayBuffer) bytes = Buffer.from(data);
  else if (
    Array.isArray(data) &&
    data.length <= QQ_MAX_PAYLOAD_BYTES &&
    data.every(Buffer.isBuffer)
  ) {
    let length = 0;
    for (const chunk of data) {
      length += chunk.length;
      if (length > QQ_MAX_PAYLOAD_BYTES) throw new QqError('size');
    }
    bytes = Buffer.concat(data, length);
  } else throw new QqError('response');
  if (bytes.length > QQ_MAX_PAYLOAD_BYTES) throw new QqError('size');
  try {
    return qqRecord(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch {
    throw new QqError('response');
  }
}

/** Owns one cancellable session. The start promise settles at the first valid READY. */
export class QqGateway {
  private readonly lifetime = new AbortController();
  private readonly reconnect: InstanceType<QqProtocol['ReconnectState']>;
  private started = false;
  private ended = false;
  private generation = 0;
  private socket?: QqSocket;
  private attempt?: AbortController;
  private cleanupSocket?: () => void;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private startTimer?: ReturnType<typeof setTimeout>;
  private readyTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private ackTimer?: ReturnType<typeof setTimeout>;
  private stableTimer?: ReturnType<typeof setTimeout>;
  private awaitingAck = false;
  private heartbeatMs = 0;
  private authenticated = false;
  private helloReceived = false;
  private resumeSent = false;
  private sessionId?: string;
  private lastSeq: number | null = null;
  private selfUserId?: string;
  private socketToken?: string;
  private handlers?: QqGatewayHandlers;
  private resolveReady?: () => void;
  private rejectReady?: (error: QqError) => void;
  private detachAbort?: () => void;

  constructor(
    private readonly sdk: QqProtocol,
    private readonly http: QqHttp,
    private readonly createSocket: QqWebSocketFactory = (url, options) =>
      new WebSocket(url, options),
  ) {
    // No logger is supplied to any SDK primitive.
    this.reconnect = new sdk.ReconnectState('qq');
  }

  start(signal: AbortSignal, handlers: QqGatewayHandlers): Promise<void> {
    if (this.started || this.ended) return Promise.reject(new QqError('stopped'));
    this.started = true;
    this.handlers = handlers;
    const pending = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const abort = () => this.stop();
    signal.addEventListener('abort', abort, { once: true });
    this.detachAbort = () => signal.removeEventListener('abort', abort);
    this.startTimer = setTimeout(() => this.fail(new QqError('timeout')), QQ_START_TIMEOUT_MS);
    if (signal.aborted) this.stop();
    else void this.connect();
    return pending;
  }

  stop(): void {
    this.finish(new QqError('cancelled'), 'offline');
  }

  private fail(error = new QqError('gateway')): void {
    this.finish(error, 'error');
  }

  private finish(error: QqError, state: 'offline' | 'error'): void {
    if (this.ended) return;
    this.ended = true;
    this.lifetime.abort();
    this.detachAbort?.();
    clearTimeout(this.startTimer);
    clearTimeout(this.reconnectTimer);
    this.teardown();
    this.sessionId = undefined;
    this.lastSeq = null;
    this.selfUserId = undefined;
    this.rejectReady?.(error);
    this.resolveReady = undefined;
    this.rejectReady = undefined;
    const handlers = this.handlers;
    this.handlers = undefined;
    notify(handlers?.state, state);
  }

  private teardown(): void {
    this.generation++;
    this.attempt?.abort();
    this.attempt = undefined;
    clearTimeout(this.readyTimer);
    clearTimeout(this.ackTimer);
    clearTimeout(this.stableTimer);
    clearInterval(this.heartbeatTimer);
    this.awaitingAck = false;
    this.authenticated = false;
    this.helloReceived = false;
    this.resumeSent = false;
    this.socketToken = undefined;
    const socket = this.socket;
    this.socket = undefined;
    this.cleanupSocket?.();
    this.cleanupSocket = undefined;
    // Retain the error sink registered at construction: terminate() while CONNECTING emits error.
    try {
      socket?.terminate();
    } catch {
      /* Socket is already gone. */
    }
  }

  private current(socket: QqSocket): boolean {
    return !this.ended && this.socket === socket;
  }

  private schedule(delay?: number): void {
    if (this.ended) return;
    this.teardown();
    if (this.reconnect.isExhausted()) return this.fail();
    notify(this.handlers?.state, 'offline');
    if (this.ended) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, this.reconnect.getNextDelay(delay));
  }

  private async connect(): Promise<void> {
    if (this.ended) return;
    const generation = this.generation;
    this.attempt = new AbortController();
    const signal = AbortSignal.any([this.attempt.signal, this.lifetime.signal]);
    notify(this.handlers?.state, 'connecting');
    try {
      const gateway = qqRecord(await this.http.request('GET', '/gateway', undefined, signal));
      const url = validateQqGatewayUrl(gateway.url);
      const token = await this.http.getAccessToken(signal);
      if (this.ended || generation !== this.generation) return;
      const socket = this.createSocket(url, {
        maxPayload: QQ_MAX_PAYLOAD_BYTES,
        handshakeTimeout: QQ_HANDSHAKE_TIMEOUT_MS,
        followRedirects: false,
        maxRedirects: 0,
        perMessageDeflate: false,
        rejectUnauthorized: true,
      });
      this.socket = socket;
      this.socketToken = token;
      const message = (data: unknown, isBinary: boolean) => {
        if (!this.current(socket)) return;
        try {
          this.onFrame(socket, readFrame(data, isBinary));
        } catch {
          this.fail(new QqError('response'));
        }
      };
      const close = (code: number) => {
        if (this.current(socket)) this.onClose(code);
      };
      const error = () => {
        if (this.current(socket)) this.schedule();
      };
      socket.on('error', () => {});
      socket.on('message', message);
      socket.on('close', close);
      socket.on('error', error);
      this.cleanupSocket = () => {
        socket.off('message', message);
        socket.off('close', close);
        socket.off('error', error);
      };
      this.readyTimer = setTimeout(() => {
        if (this.current(socket)) this.schedule();
      }, QQ_READY_TIMEOUT_MS);
    } catch (error) {
      if (this.ended || generation !== this.generation) return;
      if (
        error instanceof QqError &&
        (error.code === 'response' || error.code === 'size' || error.code === 'input')
      ) {
        this.fail(error);
      } else this.schedule();
    }
  }

  private send(socket: QqSocket, payload: unknown): void {
    if (!this.current(socket)) return;
    if (socket.readyState !== WebSocket.OPEN) return this.schedule();
    try {
      socket.send(JSON.stringify(payload), (error?: Error) => {
        if (error && this.current(socket)) this.schedule();
      });
    } catch {
      if (this.current(socket)) this.schedule();
    }
  }

  private heartbeat(socket: QqSocket): void {
    if (!this.current(socket) || this.awaitingAck) return;
    this.awaitingAck = true;
    this.ackTimer = setTimeout(() => {
      if (this.current(socket) && this.awaitingAck) this.schedule();
    }, this.heartbeatMs);
    this.send(socket, { op: this.sdk.GatewayOp.HEARTBEAT, d: this.lastSeq });
  }

  private onFrame(socket: QqSocket, frame: Record<string, unknown>): void {
    const op = this.sdk.GatewayOp;
    if (!Number.isInteger(frame.op)) throw new QqError('response');
    if (
      frame.s !== undefined &&
      frame.s !== null &&
      (typeof frame.s !== 'number' || !Number.isSafeInteger(frame.s) || frame.s < 0)
    ) {
      throw new QqError('response');
    }
    if (frame.op === op.HELLO) {
      const interval = qqRecord(frame.d).heartbeat_interval;
      if (
        this.helloReceived ||
        typeof interval !== 'number' ||
        !Number.isSafeInteger(interval) ||
        interval < 1000 ||
        interval > 120_000
      )
        throw new QqError('response');
      this.helloReceived = true;
      this.heartbeatMs = interval;
      this.resumeSent = Boolean(this.sessionId && this.lastSeq !== null);
      this.heartbeatTimer = setInterval(() => this.heartbeat(socket), interval);
      this.send(
        socket,
        this.resumeSent
          ? {
              op: op.RESUME,
              d: {
                token: `QQBot ${this.socketToken}`,
                session_id: this.sessionId,
                seq: this.lastSeq,
              },
            }
          : {
              op: op.IDENTIFY,
              d: { token: `QQBot ${this.socketToken}`, intents: QQ_MESSAGE_INTENT, shard: [0, 1] },
            },
      );
      return;
    }
    if (!this.helloReceived) throw new QqError('response');
    if (frame.op === op.HEARTBEAT_ACK) {
      this.awaitingAck = false;
      clearTimeout(this.ackTimer);
    } else if (frame.op === op.HEARTBEAT) this.heartbeat(socket);
    else if (frame.op === op.RECONNECT) this.schedule();
    else if (frame.op === op.INVALID_SESSION) {
      if (typeof frame.d !== 'boolean') throw new QqError('response');
      if (!frame.d) {
        this.sessionId = undefined;
        this.lastSeq = null;
        this.http.invalidateToken(this.socketToken);
      }
      this.schedule(3000);
    } else if (frame.op === op.DISPATCH) {
      if (typeof frame.t !== 'string' || frame.t.length > 128 || typeof frame.s !== 'number') {
        throw new QqError('response');
      }
      // Track every dispatch, including ignored event types, and retain sequence zero.
      if (this.authenticated && this.lastSeq !== null && frame.s <= this.lastSeq) return;
      this.lastSeq = frame.s;
      const event = this.sdk.GatewayEvent;
      if (
        ![
          event.READY,
          event.RESUMED,
          event.C2C_MESSAGE_CREATE,
          event.GROUP_AT_MESSAGE_CREATE,
          event.GROUP_MESSAGE_CREATE,
        ].some((type) => type === frame.t)
      )
        return;
      const result = this.sdk.dispatchEvent(frame.t, frame.d, 'qq');
      if (result.action === 'ready') {
        const data = qqRecord(result.data);
        const user = qqRecord(data.user);
        if (this.authenticated || !isQqId(result.sessionId) || !isQqId(user.id))
          throw new QqError('response');
        this.sessionId = result.sessionId;
        this.selfUserId = user.id;
        this.onReady(socket);
      } else if (result.action === 'resumed') {
        if (this.authenticated || !this.resumeSent || !this.selfUserId)
          throw new QqError('response');
        this.onReady(socket);
      } else if (result.action === 'message') {
        if (!this.authenticated) throw new QqError('response');
        // The adapter parses this SDK InboundMessage as unknown; no media is fetched or decoded here.
        notify(this.handlers?.message, result.msg);
      }
    }
  }

  private onReady(socket: QqSocket): void {
    this.authenticated = true;
    clearTimeout(this.readyTimer);
    clearTimeout(this.startTimer);
    // Only a stable authenticated connection resets the budget, never a successful HTTP upgrade.
    this.stableTimer = setTimeout(() => {
      if (this.current(socket)) this.reconnect.onConnected();
    }, this.sdk.QUICK_DISCONNECT_THRESHOLD);
    notify(this.handlers?.state, 'online');
    if (!this.current(socket)) return;
    notify(this.handlers?.ready, this.selfUserId!);
    if (!this.current(socket)) return;
    this.resolveReady?.();
    this.resolveReady = undefined;
    this.rejectReady = undefined;
  }

  private onClose(code: number): void {
    // An unsolicited normal close also needs recovery; stop() is the explicit terminal operation.
    const action = this.reconnect.handleClose(code === 1000 ? 1006 : code, false);
    if (action.clearSession) {
      this.sessionId = undefined;
      this.lastSeq = null;
    }
    if (action.refreshToken) this.http.invalidateToken(this.socketToken);
    if (action.fatal || !action.shouldReconnect) this.fail();
    else this.schedule(action.reconnectDelay);
  }
}
