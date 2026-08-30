import WebSocket, { type RawData } from 'ws';

import type { SecretStore } from '../security/secret-store';
import type { VTubeStudioConfigStore } from '../storage/vtube-studio-config-store';
import type { CharacterPresentationState } from '../../core/presentation/character-presentation';
import type {
  VTubeStudioConnectionState,
  VTubeStudioInspectResult,
  VTubeStudioInventory,
  VTubeStudioExpressionPreviewInput,
  VTubeStudioOperationResult,
  VTubeStudioPresentationInput,
  VTubeStudioSettings,
  VTubeStudioStatus,
} from '../../shared/vtube-studio-ipc';
import {
  assertAuthenticated,
  assertVTubeStudioResponseType,
  buildVTubeStudioInventory,
  buildVTubeStudioRequest,
  MAX_VTUBE_STUDIO_RESPONSE_BYTES,
  parseExpressions,
  parseVTubeStudioResponse,
  readAuthenticationToken,
  throwIfVTubeStudioError,
  VTUBE_STUDIO_PLUGIN_DEVELOPER,
  VTUBE_STUDIO_PLUGIN_NAME,
  type VTubeStudioResponse,
} from './vtube-studio-protocol';
import {
  VTubeStudioIdleMotion,
  type VTubeStudioPointerTrackingTarget,
} from './vtube-studio-idle-motion';
import {
  resolveAnimationHotkeyForAction,
  resolveExpressionForEmotion,
  resolveHotkeyForEmotion,
} from './vtube-studio-presentation';

const TOKEN_SECRET_ID = 'vtube-studio-plugin-token';
const CONNECT_TIMEOUT_MS = 2_000;
const REQUEST_TIMEOUT_MS = 5_000;
const AUTHORIZATION_TIMEOUT_MS = 120_000;
const IDLE_MOTION_INTERVAL_MS = 100;

type VTubeStudioSecretStore = Pick<SecretStore, 'get' | 'has' | 'set'>;
type SocketFactory = (url: string) => WebSocket;
type PointerSource = () => { x: number; y: number; proximity?: number } | undefined;

const noPointer: PointerSource = () => undefined;
const POINTER_ACTIVITY_HOLD_MS = 1_000;
const POINTER_FADE_MS = 1_200;
const POINTER_MOVEMENT_EPSILON_SQUARED = 0.000_025;

interface PendingRequest {
  resolve(response: VTubeStudioResponse): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const defaultSocketFactory: SocketFactory = (url) =>
  new WebSocket(url, {
    maxPayload: MAX_VTUBE_STUDIO_RESPONSE_BYTES,
    perMessageDeflate: false,
  });

class VTubeStudioApiSession {
  private socket: WebSocket | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private closed = false;

  public constructor(
    private readonly url: string,
    private readonly createSocket: SocketFactory,
    private readonly onUnexpectedClose: () => void,
  ) {}

  public connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    const socket = this.createSocket(this.url);
    this.socket = socket;
    this.closed = false;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.off('open', handleOpen);
        socket.off('error', handleInitialError);
        if (error) reject(error);
        else resolve();
      };
      const handleOpen = (): void => {
        socket.on('message', this.handleMessage);
        socket.on('close', this.handleClose);
        socket.on('error', this.handleRuntimeError);
        finish();
      };
      const handleInitialError = (): void => finish(new Error('VTube Studio is unavailable.'));
      const timer = setTimeout(() => {
        socket.terminate();
        finish(new Error('VTube Studio connection timed out.'));
      }, CONNECT_TIMEOUT_MS);
      socket.once('open', handleOpen);
      socket.once('error', handleInitialError);
    });
  }

  public request(
    messageType: string,
    data?: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<VTubeStudioResponse> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('VTube Studio is not connected.'));
    }
    const requestID = `fpnf-${Date.now().toString(36)}-${this.nextRequestId().toString(36)}`;
    return new Promise<VTubeStudioResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestID);
        reject(new Error('VTube Studio did not answer in time.'));
      }, timeoutMs);
      this.pending.set(requestID, { resolve, reject, timer });
      socket.send(
        JSON.stringify(buildVTubeStudioRequest(requestID, messageType, data)),
        (error) => {
          if (!error) return;
          const pending = this.pending.get(requestID);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(requestID);
          pending.reject(new Error('The VTube Studio request could not be sent.'));
        },
      );
    });
  }

  public get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  public close(): void {
    this.closed = true;
    const socket = this.socket;
    this.socket = undefined;
    this.rejectPending(new Error('The VTube Studio session was closed.'));
    if (!socket) return;
    socket.off('message', this.handleMessage);
    socket.off('close', this.handleClose);
    socket.off('error', this.handleRuntimeError);
    try {
      socket.close(1_000, 'FPNF adapter stopped');
    } catch {
      socket.terminate();
    }
  }

  private nextRequestId(): number {
    this.requestCounter = this.requestCounter >= 2_147_483_647 ? 1 : this.requestCounter + 1;
    return this.requestCounter;
  }

  private readonly handleMessage = (raw: RawData, isBinary: boolean): void => {
    if (isBinary) {
      this.failSession(new Error('VTube Studio returned an unsupported binary response.'));
      return;
    }
    const text = raw.toString();
    if (text.trim().length === 0) return;
    let response: VTubeStudioResponse;
    try {
      response = parseVTubeStudioResponse(text);
    } catch {
      this.failSession(new Error('VTube Studio returned an invalid response.'));
      return;
    }
    const pending = this.pending.get(response.requestID);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.requestID);
    pending.resolve(response);
  };

  private readonly handleClose = (): void => {
    this.socket = undefined;
    this.rejectPending(new Error('VTube Studio disconnected.'));
    if (!this.closed) this.onUnexpectedClose();
  };

  private readonly handleRuntimeError = (): void => {
    this.failSession(new Error('The VTube Studio connection failed.'));
  };

  private failSession(error: Error): void {
    this.rejectPending(error);
    const socket = this.socket;
    this.socket = undefined;
    try {
      socket?.terminate();
    } catch {
      // Optional display cleanup is best effort.
    }
    if (!this.closed) this.onUnexpectedClose();
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export class VTubeStudioService {
  private session: VTubeStudioApiSession | undefined;
  private connection: VTubeStudioConnectionState = 'disconnected';
  private inventory: VTubeStudioInventory | undefined;
  private activeExpressionFile: string | undefined;
  private presentationState: CharacterPresentationState = 'idle';
  private idleMotion: VTubeStudioIdleMotion | undefined;
  private idleMotionTimer: ReturnType<typeof setInterval> | undefined;
  private idleMotionRequestInFlight = false;
  private inspectInFlight: Promise<VTubeStudioInspectResult> | undefined;
  private mouseTrackingEnabled = false;
  private lastPointer: { x: number; y: number } | undefined;
  private smoothedHeadPointer: { x: number; y: number } | undefined;
  private lastPointerActivityAt = 0;

  public constructor(
    private readonly store: VTubeStudioConfigStore,
    private readonly secrets: VTubeStudioSecretStore,
    private readonly createSocket: SocketFactory = defaultSocketFactory,
    private readonly pointerSource: PointerSource = noPointer,
  ) {}

  public async getStatus(): Promise<VTubeStudioStatus> {
    const settings = await this.store.get();
    const authorized = await this.secrets.has(TOKEN_SECRET_ID).catch(() => false);
    const connection = settings.enabled ? this.connection : 'disabled';
    return {
      settings,
      connection,
      authorized,
      detail:
        connection === 'connected'
          ? '已连接并授权本机 VTube Studio。'
          : connection === 'connecting'
            ? '正在连接本机 VTube Studio。'
            : connection === 'awaiting-authorization'
              ? '请在 VTube Studio 中确认插件授权。'
              : connection === 'disabled'
                ? 'VTube Studio 角色显示已关闭。'
                : authorized
                  ? '已保存 VTube Studio 授权；当前尚未连接。'
                  : '尚未授权 VTube Studio 插件。',
    };
  }

  public async setSettings(settings: VTubeStudioSettings): Promise<VTubeStudioOperationResult> {
    try {
      await this.store.set(settings);
      this.mouseTrackingEnabled = settings.mouseTrackingEnabled;
      this.disconnect();
      this.connection = settings.enabled ? 'disconnected' : 'disabled';
      return { ok: true };
    } catch {
      return { ok: false, message: 'VTube Studio 设置无法保存。' };
    }
  }

  public async authorize(): Promise<VTubeStudioOperationResult> {
    let temporarySession: VTubeStudioApiSession | undefined;
    try {
      const settings = await this.store.get();
      this.disconnect();
      this.connection = 'awaiting-authorization';
      temporarySession = this.createSession(settings.port);
      await temporarySession.connect();
      const response = await temporarySession.request(
        'AuthenticationTokenRequest',
        {
          pluginName: VTUBE_STUDIO_PLUGIN_NAME,
          pluginDeveloper: VTUBE_STUDIO_PLUGIN_DEVELOPER,
        },
        AUTHORIZATION_TIMEOUT_MS,
      );
      throwIfVTubeStudioError(response);
      await this.secrets.set(TOKEN_SECRET_ID, readAuthenticationToken(response));
      this.connection = 'disconnected';
      return { ok: true, message: 'VTube Studio 已授权。' };
    } catch {
      this.connection = 'disconnected';
      return { ok: false, message: 'VTube Studio 授权未完成。' };
    } finally {
      temporarySession?.close();
    }
  }

  public async inspect(): Promise<VTubeStudioInspectResult> {
    if (this.inspectInFlight) return this.inspectInFlight;
    const inspection = this.performInspect();
    this.inspectInFlight = inspection;
    try {
      return await inspection;
    } finally {
      if (this.inspectInFlight === inspection) this.inspectInFlight = undefined;
    }
  }

  private async performInspect(): Promise<VTubeStudioInspectResult> {
    try {
      if (this.session?.isOpen && this.inventory) {
        return { ok: true, inventory: this.inventory };
      }
      const settings = await this.store.get();
      this.mouseTrackingEnabled = settings.mouseTrackingEnabled;
      const token = await this.secrets.get(TOKEN_SECRET_ID);
      if (!token) {
        return { ok: false, message: '请先完成 VTube Studio 插件授权。' };
      }
      this.disconnect();
      this.connection = 'connecting';
      const session = this.createSession(settings.port);
      this.session = session;
      await session.connect();
      const authentication = await session.request('AuthenticationRequest', {
        pluginName: VTUBE_STUDIO_PLUGIN_NAME,
        pluginDeveloper: VTUBE_STUDIO_PLUGIN_DEVELOPER,
        authenticationToken: token,
      });
      throwIfVTubeStudioError(authentication);
      assertAuthenticated(authentication);
      const model = await session.request('CurrentModelRequest');
      const hotkeys = await session.request('HotkeysInCurrentModelRequest');
      const expressions = await session.request('ExpressionStateRequest', {
        details: true,
        expressionFile: '',
      });
      const parameters = await session.request('Live2DParameterListRequest');
      const inventory = buildVTubeStudioInventory(model, hotkeys, expressions, parameters);
      this.inventory = inventory;
      this.connection = 'connected';
      return { ok: true, inventory };
    } catch (error) {
      console.warn(
        'Unable to inspect the current VTube Studio model.',
        error instanceof Error ? error.message : 'Unknown inspection error.',
      );
      this.disconnect();
      this.connection = 'disconnected';
      return { ok: false, message: '无法读取 VTube Studio 模型清单。' };
    }
  }

  public async present(input: VTubeStudioPresentationInput): Promise<boolean> {
    if (!input.state && !input.emotion && !input.action) return false;
    try {
      const settings = await this.store.get();
      if (!settings.enabled) return false;
      const inspected = await this.inspect();
      const session = this.session;
      const inventory = inspected.inventory;
      if (!inspected.ok || !session?.isOpen || !inventory) return false;

      let presented = false;
      if (input.state) {
        this.presentationState = input.state;
        this.startIdleMotion();
        await this.sendIdleMotionFrame();
        presented = true;
      }
      if (input.emotion) {
        const expressionState = await session.request('ExpressionStateRequest', {
          details: true,
          expressionFile: '',
        });
        inventory.expressions = parseExpressions(expressionState);
        const directExpression = resolveExpressionForEmotion(inventory.expressions, input.emotion);
        const emotionHotkey = directExpression
          ? undefined
          : resolveHotkeyForEmotion(inventory.hotkeys, input.emotion);
        const expression =
          directExpression ??
          (emotionHotkey?.type === 'ToggleExpression'
            ? inventory.expressions.find((candidate) => candidate.file === emotionHotkey.file)
            : undefined);
        const nextFile = expression?.file;
        if (this.activeExpressionFile && this.activeExpressionFile !== nextFile) {
          const response = await session.request('ExpressionActivationRequest', {
            expressionFile: this.activeExpressionFile,
            fadeTime: 0.2,
            active: false,
          });
          assertVTubeStudioResponseType(response, 'ExpressionActivationResponse');
          this.activeExpressionFile = undefined;
          presented = true;
        }
        if (expression?.active) {
          presented = true;
        } else if (nextFile) {
          const response = await session.request('ExpressionActivationRequest', {
            expressionFile: nextFile,
            fadeTime: 0.2,
            active: true,
          });
          assertVTubeStudioResponseType(response, 'ExpressionActivationResponse');
          this.activeExpressionFile = nextFile;
          presented = true;
        }
        if (!expression && emotionHotkey?.type === 'TriggerAnimation') {
          const response = await session.request('HotkeyTriggerRequest', {
            hotkeyID: emotionHotkey.hotkeyId,
          });
          assertVTubeStudioResponseType(response, 'HotkeyTriggerResponse');
          presented = true;
        }
      }

      if (input.action) {
        const hotkey = resolveAnimationHotkeyForAction(inventory.hotkeys, input.action);
        if (hotkey) {
          const response = await session.request('HotkeyTriggerRequest', {
            hotkeyID: hotkey.hotkeyId,
          });
          assertVTubeStudioResponseType(response, 'HotkeyTriggerResponse');
          presented = true;
        } else {
          this.startIdleMotion();
          if (this.idleMotion?.triggerAction(input.action)) {
            await this.sendIdleMotionFrame();
            presented = true;
          }
        }
      }
      return presented;
    } catch {
      this.disconnect();
      this.connection = 'disconnected';
      return false;
    }
  }

  public async previewExpression(
    input: VTubeStudioExpressionPreviewInput,
  ): Promise<VTubeStudioOperationResult> {
    try {
      const settings = await this.store.get();
      if (!settings.enabled) return { ok: false, message: '请先启用 VTube Studio 显示。' };
      const inspected = await this.inspect();
      const session = this.session;
      const inventory = inspected.inventory;
      if (!inspected.ok || !session?.isOpen || !inventory) {
        return { ok: false, message: '无法读取当前 VTube Studio 模型。' };
      }

      if (!input.active) {
        if (!this.activeExpressionFile) return { ok: true, message: '当前没有预览表情。' };
        const response = await session.request('ExpressionActivationRequest', {
          expressionFile: this.activeExpressionFile,
          fadeTime: 0.2,
          active: false,
        });
        assertVTubeStudioResponseType(response, 'ExpressionActivationResponse');
        this.activeExpressionFile = undefined;
        return { ok: true, message: '已恢复模型原始表情。' };
      }

      const expression = inventory.expressions[input.expressionIndex];
      if (!expression) return { ok: false, message: '所选表情已经不在当前模型中。' };
      if (this.activeExpressionFile && this.activeExpressionFile !== expression.file) {
        const cleared = await session.request('ExpressionActivationRequest', {
          expressionFile: this.activeExpressionFile,
          fadeTime: 0.2,
          active: false,
        });
        assertVTubeStudioResponseType(cleared, 'ExpressionActivationResponse');
        this.activeExpressionFile = undefined;
      }
      if (this.activeExpressionFile !== expression.file) {
        const activated = await session.request('ExpressionActivationRequest', {
          expressionFile: expression.file,
          fadeTime: 0.2,
          active: true,
        });
        assertVTubeStudioResponseType(activated, 'ExpressionActivationResponse');
        this.activeExpressionFile = expression.file;
      }
      return { ok: true, message: `正在预览“${expression.name}”。` };
    } catch {
      this.disconnect();
      this.connection = 'disconnected';
      return { ok: false, message: 'VTube Studio 表情预览失败。' };
    }
  }

  public dispose(): void {
    this.disconnect();
    this.connection = 'disabled';
  }

  private createSession(port: number): VTubeStudioApiSession {
    return new VTubeStudioApiSession(`ws://127.0.0.1:${port}`, this.createSocket, () => {
      this.stopIdleMotion();
      this.connection = 'disconnected';
      this.session = undefined;
    });
  }

  private startIdleMotion(): void {
    if (this.idleMotionTimer) return;
    this.idleMotion = new VTubeStudioIdleMotion();
    this.idleMotionTimer = setInterval(() => {
      void this.sendIdleMotionFrame();
    }, IDLE_MOTION_INTERVAL_MS);
    this.idleMotionTimer.unref?.();
  }

  private stopIdleMotion(): void {
    if (this.idleMotionTimer) clearInterval(this.idleMotionTimer);
    this.idleMotionTimer = undefined;
    this.idleMotion = undefined;
    this.idleMotionRequestInFlight = false;
  }

  private async sendIdleMotionFrame(): Promise<void> {
    const session = this.session;
    const idleMotion = this.idleMotion;
    if (!session?.isOpen || !idleMotion || this.idleMotionRequestInFlight) return;
    this.idleMotionRequestInFlight = true;
    try {
      const now = Date.now();
      const response = await session.request('InjectParameterDataRequest', {
        mode: 'set',
        parameterValues: idleMotion.frame(now, this.presentationState, this.readPointerTarget(now)),
      });
      assertVTubeStudioResponseType(response, 'InjectParameterDataResponse');
    } catch (error) {
      console.warn(
        'Unable to animate the idle VTube Studio model.',
        error instanceof Error ? error.message : 'Unknown idle animation error.',
      );
      this.stopIdleMotion();
    } finally {
      this.idleMotionRequestInFlight = false;
    }
  }

  private disconnect(): void {
    this.stopIdleMotion();
    const session = this.session;
    this.session = undefined;
    this.inventory = undefined;
    this.activeExpressionFile = undefined;
    this.lastPointer = undefined;
    this.smoothedHeadPointer = undefined;
    this.lastPointerActivityAt = 0;
    session?.close();
  }

  private readPointerTarget(now: number): VTubeStudioPointerTrackingTarget | undefined {
    if (!this.mouseTrackingEnabled) return undefined;
    let raw: { x: number; y: number; proximity?: number } | undefined;
    try {
      raw = this.pointerSource();
    } catch {
      return undefined;
    }
    if (!raw || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return undefined;
    const point = {
      x: Math.min(1, Math.max(-1, raw.x)),
      y: Math.min(1, Math.max(-1, raw.y)),
    };
    const proximity = Math.min(1, Math.max(0, raw.proximity ?? 0));
    const previous = this.lastPointer;
    const moved =
      !previous ||
      (point.x - previous.x) ** 2 + (point.y - previous.y) ** 2 >= POINTER_MOVEMENT_EPSILON_SQUARED;
    this.lastPointer = point;
    const previousHead = this.smoothedHeadPointer;
    this.smoothedHeadPointer = previousHead
      ? {
          x: previousHead.x + (point.x - previousHead.x) * 0.2,
          y: previousHead.y + (point.y - previousHead.y) * 0.2,
        }
      : point;
    if (moved) this.lastPointerActivityAt = now;
    const idleFor = Math.max(0, now - this.lastPointerActivityAt);
    const weight =
      idleFor <= POINTER_ACTIVITY_HOLD_MS
        ? 1
        : Math.max(0, 1 - (idleFor - POINTER_ACTIVITY_HOLD_MS) / POINTER_FADE_MS);
    return weight > 0
      ? {
          ...point,
          headX: this.smoothedHeadPointer.x,
          headY: this.smoothedHeadPointer.y,
          weight,
          proximity,
        }
      : undefined;
  }
}
