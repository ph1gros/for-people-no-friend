import type { ViewerExConfigStore } from '../storage/viewerex-config-store';
import {
  type ViewerExConnectionState,
  type ViewerExOperationResult,
  type ViewerExPresentationInput,
  type ViewerExSettings,
  type ViewerExStatus,
} from '../../shared/viewerex-ipc';
import { buildViewerExPresentationMessages } from './viewerex-protocol';
import type { SafeDiagnosticSink } from '../diagnostics/safe-diagnostic-log';

const SOCKET_OPEN = 1;
const CONNECT_TIMEOUT_MS = 1_500;

export interface ViewerExSocket {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onclose: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(value: string): void;
  close(code?: number, reason?: string): void;
}

export type ViewerExSocketFactory = (url: string) => ViewerExSocket;

const defaultSocketFactory: ViewerExSocketFactory = (url) =>
  new WebSocket(url) as unknown as ViewerExSocket;

export class ViewerExService {
  private socket: ViewerExSocket | undefined;
  private connection: ViewerExConnectionState = 'disconnected';
  private connecting: Promise<boolean> | undefined;
  private cancelConnection: (() => void) | undefined;
  private messageId = 0;
  private ownsExpression = false;
  private motionIndex = 0;
  private revision = 0;

  public constructor(
    private readonly store: ViewerExConfigStore,
    private readonly createSocket: ViewerExSocketFactory = defaultSocketFactory,
    private readonly diagnostics?: SafeDiagnosticSink,
  ) {}

  public async getStatus(): Promise<ViewerExStatus> {
    const settings = await this.store.get();
    const connection = settings.enabled ? this.connection : 'disabled';
    return {
      settings,
      connection,
      detail:
        connection === 'connected'
          ? '已连接本机 Live2DViewerEX。'
          : connection === 'connecting'
            ? '正在连接本机 Live2DViewerEX。'
            : connection === 'disabled'
              ? 'ViewerEX 角色显示已关闭。'
              : 'ViewerEX 未连接；文字聊天仍可使用。',
    };
  }

  public async setSettings(settings: ViewerExSettings): Promise<ViewerExOperationResult> {
    try {
      const previous = await this.store.get();
      await this.store.set(settings);
      if (
        !settings.enabled ||
        previous.port !== settings.port ||
        previous.modelIndex !== settings.modelIndex ||
        previous.workshopItemId !== settings.workshopItemId
      ) {
        if (this.ownsExpression && this.socket?.readyState === SOCKET_OPEN) {
          try {
            this.socket.send(
              JSON.stringify({
                msg: 13302,
                msgId: this.nextMessageId(),
                data: previous.modelIndex,
              }),
            );
          } catch {
            /* Optional display cleanup. */
          }
        }
        this.disconnect();
      } else {
        this.revision += 1;
      }
      if (!settings.enabled) this.connection = 'disabled';
      else this.connection = this.socket?.readyState === SOCKET_OPEN ? 'connected' : 'disconnected';
      return { ok: true };
    } catch {
      this.diagnostics?.('viewerex-configuration-failed');
      return { ok: false, message: 'ViewerEX 设置无法保存。' };
    }
  }

  public async present(input: ViewerExPresentationInput): Promise<boolean> {
    const revision = this.revision;
    let settings: ViewerExSettings;
    try {
      settings = await this.store.get();
    } catch {
      this.diagnostics?.('viewerex-configuration-failed');
      return false;
    }
    if (!settings.enabled) {
      this.connection = 'disabled';
      return false;
    }

    if (revision !== this.revision) return false;
    const messages = buildViewerExPresentationMessages(
      settings,
      input,
      () => this.nextMessageId(),
      { ownsExpression: this.ownsExpression, motionIndex: this.motionIndex },
    );
    if (messages.length === 0) return false;
    if (!(await this.ensureConnected(settings.port))) return false;
    if (revision !== this.revision || this.socket?.readyState !== SOCKET_OPEN) return false;

    try {
      for (const message of messages) {
        this.socket.send(JSON.stringify(message));
        if (message.msg === 13300) this.ownsExpression = true;
        if (message.msg === 13302) this.ownsExpression = false;
      }
      if (input.emotion && settings.emotionMotions?.[input.emotion]?.length)
        this.motionIndex = (this.motionIndex + 1) % 840;
      return true;
    } catch {
      this.diagnostics?.('viewerex-connection-failed');
      this.disconnect();
      this.connection = 'disconnected';
      return false;
    }
  }

  public dispose(): void {
    this.disconnect();
    this.connection = 'disabled';
  }

  private nextMessageId(): number {
    this.messageId = this.messageId >= 2_147_483_647 ? 1 : this.messageId + 1;
    return this.messageId;
  }

  private ensureConnected(port: number): Promise<boolean> {
    if (this.socket?.readyState === SOCKET_OPEN) {
      this.connection = 'connected';
      return Promise.resolve(true);
    }
    if (this.connecting) return this.connecting;

    this.connection = 'connecting';
    const socket = this.createSocket(`ws://127.0.0.1:${port}/api`);
    this.socket = socket;
    this.connecting = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (connected: boolean): void => {
        if (settled) return;
        settled = true;
        if (!connected) this.diagnostics?.('viewerex-connection-failed');
        clearTimeout(timer);
        if (this.socket === socket) {
          this.connecting = undefined;
          this.cancelConnection = undefined;
          this.connection = connected ? 'connected' : 'disconnected';
          if (!connected) this.socket = undefined;
        }
        resolve(connected);
      };
      const timer = setTimeout(() => {
        try {
          socket.close(1_000, 'Connection timeout');
        } catch {
          // A failed optional display adapter must not affect chat.
        }
        finish(false);
      }, CONNECT_TIMEOUT_MS);
      this.cancelConnection = () => finish(false);
      socket.onopen = () => finish(true);
      socket.onerror = () => finish(false);
      socket.onclose = () => {
        if (this.socket !== socket) {
          finish(false);
          return;
        }
        this.ownsExpression = false;
        finish(false);
        this.socket = undefined;
        if (settled) this.connection = 'disconnected';
      };
    });
    return this.connecting;
  }

  private disconnect(): void {
    this.revision += 1;
    this.ownsExpression = false;
    this.motionIndex = 0;
    const socket = this.socket;
    this.cancelConnection?.();
    this.cancelConnection = undefined;
    this.socket = undefined;
    this.connecting = undefined;
    if (!socket) return;
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close(1_000, 'ViewerEX adapter stopped');
    } catch {
      // Optional display shutdown is best effort.
    }
  }
}
