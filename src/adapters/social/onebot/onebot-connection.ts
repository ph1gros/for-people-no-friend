import WebSocket, { type ClientOptions } from 'ws';

export type OneBotSocket = Pick<WebSocket, 'on' | 'off' | 'send' | 'terminate' | 'readyState'>;
export type OneBotWebSocketFactory = (url: string, options: ClientOptions) => OneBotSocket;

export type OneBotFault = 'input' | 'request' | 'response' | 'timeout' | 'cancelled' | 'gateway';

/** Carries no upstream text: a bridge is community software and its errors are untrusted. */
export class OneBotError extends Error {
  public constructor(public readonly fault: OneBotFault) {
    super(`OneBot bridge failed: ${fault}`);
    this.name = 'OneBotError';
  }
}

export interface OneBotConnectionHandlers {
  ready: (selfId: string) => void;
  event: (value: unknown) => void;
  state: (state: 'connecting' | 'online' | 'offline' | 'error') => void;
}

export const ONEBOT_CALL_TIMEOUT_MS = 15_000;
export const ONEBOT_MAX_PENDING_CALLS = 32;
export const ONEBOT_MAX_FRAME_BYTES = 512 * 1_024;
export const ONEBOT_RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * A OneBot endpoint is supplied by the user, so it is treated as untrusted configuration rather
 * than as a trusted address.
 *
 * **Loopback only, by design.** The bridge is expected to run on this machine alongside the app.
 * Refusing every other host keeps a mistyped or hostile setting from turning the main process into
 * a request forwarder against the local network. Remote bridges would need an explicit, separately
 * reviewed opt-in.
 */
export const validateOneBotUrl = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) {
    throw new OneBotError('input');
  }
  if (/[\s\\]/u.test(value)) throw new OneBotError('input');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OneBotError('input');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (
    (url.protocol !== 'ws:' && url.protocol !== 'wss:') ||
    !LOOPBACK_HOSTS.has(host) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new OneBotError('input');
  }
  return url.href;
};

const decodeFrame = (data: unknown): Record<string, unknown> | undefined => {
  try {
    let text: string | undefined;
    if (typeof data === 'string') text = data;
    else if (data instanceof ArrayBuffer) {
      if (data.byteLength > ONEBOT_MAX_FRAME_BYTES) return undefined;
      text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } else if (ArrayBuffer.isView(data)) {
      if (data.byteLength > ONEBOT_MAX_FRAME_BYTES) return undefined;
      text = new TextDecoder('utf-8', { fatal: true }).decode(data as Uint8Array);
    }
    if (text === undefined || text.length > ONEBOT_MAX_FRAME_BYTES) return undefined;
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface OneBotConnectionOptions {
  url: string;
  accessToken?: string;
  webSocketFactory?: OneBotWebSocketFactory;
}

/**
 * Forward WebSocket client for a OneBot v11 implementation: request/response correlation by
 * `echo`, bounded pending calls, and backoff reconnect. Owns no platform credentials beyond the
 * optional access token, which is only ever sent as a header.
 */
export class OneBotConnection {
  private socket?: OneBotSocket;
  private handlers?: OneBotConnectionHandlers;
  private readonly pending = new Map<string, PendingCall>();
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private attempt = 0;
  private sequence = 0;
  private selfId = '';
  private stopped = false;
  private started = false;
  private ready = false;

  public constructor(private readonly options: OneBotConnectionOptions) {
    validateOneBotUrl(options.url);
  }

  public start(handlers: OneBotConnectionHandlers): void {
    if (this.stopped) throw new OneBotError('cancelled');
    if (this.started) throw new OneBotError('gateway');
    this.started = true;
    this.handlers = handlers;
    this.open();
  }

  public stop(): void {
    this.stopped = true;
    this.ready = false;
    this.selfId = '';
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.failPending(new OneBotError('cancelled'));
    const socket = this.socket;
    this.socket = undefined;
    socket?.terminate();
    this.handlers?.state('offline');
  }

  public get connected(): boolean {
    return this.ready && this.selfId !== '';
  }

  /** Issues one OneBot action and resolves with its `data`, or rejects with a neutral error. */
  public async call(action: string, params: Record<string, unknown>): Promise<unknown> {
    if (!/^[a-z_]{1,64}$/u.test(action)) throw new OneBotError('input');
    const socket = this.socket;
    if (!socket || !this.ready) throw new OneBotError('gateway');
    if (this.pending.size >= ONEBOT_MAX_PENDING_CALLS) throw new OneBotError('request');

    this.sequence += 1;
    const echo = `fpnf-${this.sequence}`;
    const frame = JSON.stringify({ action, params, echo });
    if (Buffer.byteLength(frame) > ONEBOT_MAX_FRAME_BYTES) throw new OneBotError('input');

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new OneBotError('timeout'));
      }, ONEBOT_CALL_TIMEOUT_MS);
      this.pending.set(echo, { resolve, reject, timer });
      try {
        socket.send(frame);
      } catch {
        this.pending.delete(echo);
        clearTimeout(timer);
        reject(new OneBotError('request'));
      }
    });
  }

  private open(): void {
    if (this.stopped || this.socket) return;
    this.handlers?.state('connecting');
    const headers = this.options.accessToken
      ? { Authorization: `Bearer ${this.options.accessToken}` }
      : undefined;
    let socket: OneBotSocket;
    try {
      socket = (this.options.webSocketFactory ?? ((url, init) => new WebSocket(url, init)))(
        this.options.url,
        { maxPayload: ONEBOT_MAX_FRAME_BYTES, ...(headers ? { headers } : {}) },
      );
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.on('open', () => this.onOpen(socket));
    socket.on('message', (data: unknown) => this.receive(socket, data));
    socket.on('close', () => this.onDisconnected(socket));
    // Keep an error listener even after retirement; late errors must not become uncaught.
    socket.on('error', () => this.onDisconnected(socket));
  }

  private onOpen(socket: OneBotSocket): void {
    if (this.stopped || this.socket !== socket || this.ready) return;
    this.ready = true;
    // The login identity decides which messages are our own; ask for it before doing anything.
    void this.call('get_login_info', {})
      .then((data) => {
        if (this.stopped || this.socket !== socket) return;
        const record =
          typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
        const id = record.user_id;
        const selfId =
          typeof id === 'number' && Number.isInteger(id) && id >= 0
            ? String(id)
            : typeof id === 'string' && /^[A-Za-z0-9_:.-]{1,128}$/u.test(id)
              ? id
              : undefined;
        if (!selfId) {
          this.onDisconnected(socket);
          return;
        }
        this.selfId = selfId;
        this.attempt = 0;
        this.handlers?.ready(selfId);
        if (!this.stopped && this.socket === socket) this.handlers?.state('online');
      })
      .catch(() => this.onDisconnected(socket));
  }

  private receive(socket: OneBotSocket, data: unknown): void {
    if (this.stopped || this.socket !== socket) return;
    const frame = decodeFrame(data);
    if (!frame) return;
    if (typeof frame.echo === 'string') {
      const call = this.pending.get(frame.echo);
      if (!call) return;
      this.pending.delete(frame.echo);
      clearTimeout(call.timer);
      if (frame.status === 'ok' || frame.retcode === 0) call.resolve(frame.data);
      else call.reject(new OneBotError('response'));
      return;
    }
    // Anything without an echo is a pushed event; the adapter decides what to do with it.
    if (this.selfId) this.handlers?.event(frame);
  }

  private onDisconnected(socket: OneBotSocket): void {
    if (this.stopped || this.socket !== socket) return;
    // Invalidate before termination/failing RPCs: both can enqueue more close/error callbacks.
    this.socket = undefined;
    this.ready = false;
    this.selfId = '';
    this.failPending(new OneBotError('gateway'));
    socket.terminate();
    this.handlers?.state('connecting');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.socket || this.reconnectTimer !== undefined) return;
    const delay =
      ONEBOT_RECONNECT_DELAYS_MS[Math.min(this.attempt, ONEBOT_RECONNECT_DELAYS_MS.length - 1)] ??
      30_000;
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.open();
    }, delay);
  }

  private failPending(error: Error): void {
    for (const [echo, call] of [...this.pending]) {
      this.pending.delete(echo);
      clearTimeout(call.timer);
      call.reject(error);
    }
  }
}
