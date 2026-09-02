import WebSocket, { type RawData } from 'ws';

import type { SecretStore } from '../security/secret-store';
import type { VTubeStudioConfigStore } from '../storage/vtube-studio-config-store';
import type { CharacterPresentationState } from '../../core/presentation/character-presentation';
import type {
  VTubeStudioConnectionState,
  VTubeStudioAuthorizationResult,
  VTubeStudioInspectResult,
  VTubeStudioInventory,
  VTubeStudioExpressionPreviewInput,
  VTubeStudioOperationResult,
  VTubeStudioPresentationInput,
  VTubeStudioPresentationResult,
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
  resolveConfirmedModelMapping,
  selectControlledActiveExpressionFiles,
  suggestVTubeStudioModelMapping,
} from './vtube-studio-presentation';
import { discoverVTubeStudioApi, type VTubeStudioApiDiscovery } from './vtube-studio-discovery';

const TOKEN_SECRET_ID = 'vtube-studio-plugin-token';
const CONNECT_TIMEOUT_MS = 2_000;
const REQUEST_TIMEOUT_MS = 5_000;
const AUTHORIZATION_TIMEOUT_MS = 120_000;
const IDLE_MOTION_INTERVAL_MS = 100;

type VTubeStudioSecretStore = Pick<SecretStore, 'get' | 'has' | 'set'> &
  Partial<Pick<SecretStore, 'delete'>>;
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

class VTubeStudioAuthorizationExpiredError extends Error {}
class VTubeStudioApiDisabledError extends Error {}

const unavailableMessage =
  '无法连接 VTube Studio。请确认它已启动；如果已经启动，请打开“允许插件 API 访问”后再次连接。';
const apiDisabledMessage =
  'VTube Studio 已运行，但插件接口尚未开启。请在它的设置首页打开“允许插件 API 访问”，然后回来再次连接。';

const isConnectionUnavailable = (error: unknown): boolean =>
  error instanceof Error &&
  (error.message === 'VTube Studio is unavailable.' ||
    error.message === 'VTube Studio connection timed out.');

const emotionLabels: Record<NonNullable<VTubeStudioPresentationInput['emotion']>, string> = {
  neutral: '中性',
  happy: '开心',
  sad: '难过',
  angry: '生气',
  surprised: '惊讶',
  shy: '害羞',
  playful: '俏皮',
};

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
  private displayTransportDetail: string | undefined;
  private mouseTrackingEnabled = false;
  private lastPointer: { x: number; y: number } | undefined;
  private smoothedHeadPointer: { x: number; y: number } | undefined;
  private lastPointerActivityAt = 0;

  public constructor(
    private readonly store: VTubeStudioConfigStore,
    private readonly secrets: VTubeStudioSecretStore,
    private readonly createSocket: SocketFactory = defaultSocketFactory,
    private readonly pointerSource: PointerSource = noPointer,
    private readonly discoverApi: VTubeStudioApiDiscovery = discoverVTubeStudioApi,
  ) {}

  public async getStatus(): Promise<VTubeStudioStatus> {
    const settings = await this.store.get();
    const authorized = Boolean(await this.secrets.get(TOKEN_SECRET_ID).catch(() => undefined));
    const connection = settings.enabled ? this.connection : 'disabled';
    return {
      settings,
      connection,
      authorized,
      bundledModelAvailable: false,
      detail:
        (connection === 'connected' ? this.displayTransportDetail : undefined) ??
        (connection === 'connected'
          ? '已连接并授权本机 VTube Studio。'
          : connection === 'connecting'
            ? '正在连接本机 VTube Studio。'
            : connection === 'awaiting-authorization'
              ? '请在 VTube Studio 中确认插件授权。'
              : connection === 'disabled'
                ? 'VTube Studio 角色显示已关闭。'
                : authorized
                  ? '已保存 VTube Studio 授权；当前尚未连接。'
                  : '尚未授权 VTube Studio 插件。'),
    };
  }

  public setDisplayTransportDiagnostic(event: string): void {
    if (event === 'FPNF_SPOUT_READY') {
      this.displayTransportDetail = undefined;
      return;
    }
    if (event === 'FPNF_SPOUT_SOURCE_UNAVAILABLE') {
      this.displayTransportDetail =
        'VTube Studio API 已连接，但没有发现 Spout2 输出；请在 VTube Studio 中启用 Spout2。';
      return;
    }
    if (event === 'FPNF_SPOUT_FRAME_UNAVAILABLE') {
      this.displayTransportDetail =
        'VTube Studio API 已连接，但 Spout2 模型画面无法接收；请让 VTube Studio 与桌宠使用同一块高性能显卡。';
    }
  }

  public async setSettings(settings: VTubeStudioSettings): Promise<VTubeStudioOperationResult> {
    try {
      const current = await this.store.get();
      await this.store.set(settings);
      this.mouseTrackingEnabled = settings.mouseTrackingEnabled;
      if (current.enabled !== settings.enabled || current.port !== settings.port) {
        this.disconnect();
        this.connection = settings.enabled ? 'disconnected' : 'disabled';
      } else if (!settings.enabled) {
        this.connection = 'disabled';
      }
      return { ok: true };
    } catch {
      return { ok: false, message: 'VTube Studio 设置无法保存。' };
    }
  }

  public async authorize(): Promise<VTubeStudioAuthorizationResult> {
    let temporarySession: VTubeStudioApiSession | undefined;
    try {
      const settings = await this.store.get();
      this.disconnect();
      this.connection = 'awaiting-authorization';
      const connected = await this.connectUsingConfiguredOrDiscoveredPort(settings);
      temporarySession = connected.session;
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
      return { ok: true, reason: 'authorized', message: 'VTube Studio 已授权。' };
    } catch (error) {
      this.connection = 'disconnected';
      if (error instanceof VTubeStudioApiDisabledError) {
        return { ok: false, reason: 'api-disabled', message: apiDisabledMessage };
      }
      return {
        ok: false,
        reason: isConnectionUnavailable(error) ? 'unavailable' : 'authorization-denied',
        message: isConnectionUnavailable(error)
          ? unavailableMessage
          : 'VTube Studio 授权未完成；请在 VTube Studio 弹窗中点击“允许”。',
      };
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
      let settings = await this.store.get();
      this.mouseTrackingEnabled = settings.mouseTrackingEnabled;
      let session = this.session;
      if (!session?.isOpen) {
        const token = await this.secrets.get(TOKEN_SECRET_ID);
        if (!token) {
          return { ok: false, message: '请先完成 VTube Studio 插件授权。' };
        }
        this.disconnect();
        this.connection = 'connecting';
        const connected = await this.connectUsingConfiguredOrDiscoveredPort(settings);
        session = connected.session;
        this.session = session;
        const authentication = await session.request('AuthenticationRequest', {
          pluginName: VTUBE_STUDIO_PLUGIN_NAME,
          pluginDeveloper: VTUBE_STUDIO_PLUGIN_DEVELOPER,
          authenticationToken: token,
        });
        try {
          throwIfVTubeStudioError(authentication);
          assertAuthenticated(authentication);
        } catch (error) {
          await this.secrets.delete?.(TOKEN_SECRET_ID).catch(() => undefined);
          throw new VTubeStudioAuthorizationExpiredError(
            'VTube Studio rejected the saved authorization.',
            { cause: error },
          );
        }
      }
      const model = await session.request('CurrentModelRequest');
      const hotkeys = await session.request('HotkeysInCurrentModelRequest');
      const expressions = await session.request('ExpressionStateRequest', {
        details: true,
        expressionFile: '',
      });
      const parameters = await session.request('Live2DParameterListRequest');
      const inventory = buildVTubeStudioInventory(model, hotkeys, expressions, parameters);
      if (!inventory.model.loaded || !inventory.model.id) {
        this.disconnect();
        this.connection = 'disconnected';
        return { ok: false, message: 'VTube Studio 当前没有加载可读取的模型。' };
      }
      let confirmed = resolveConfirmedModelMapping(
        settings.modelMappings ?? {},
        inventory.model.id,
      );
      if (!confirmed && Object.keys(settings.emotionExpressions ?? {}).length > 0) {
        confirmed = {
          modelName: inventory.model.name,
          emotionExpressions: { ...settings.emotionExpressions },
          actionHotkeys: {},
        };
        settings = {
          ...settings,
          emotionExpressions: {},
          modelMappings: {
            ...(settings.modelMappings ?? {}),
            [inventory.model.id]: confirmed,
          },
        };
        await this.store.set(settings);
      }
      this.inventory = inventory;
      this.connection = 'connected';
      return {
        ok: true,
        inventory,
        mapping: {
          modelId: inventory.model.id,
          modelName: inventory.model.name,
          confirmed,
          suggestions: suggestVTubeStudioModelMapping(inventory),
        },
      };
    } catch (error) {
      console.warn(
        'Unable to inspect the current VTube Studio model.',
        error instanceof Error ? error.message : 'Unknown inspection error.',
      );
      this.disconnect();
      this.connection = 'disconnected';
      return {
        ok: false,
        reason:
          error instanceof VTubeStudioApiDisabledError
            ? 'api-disabled'
            : error instanceof VTubeStudioAuthorizationExpiredError
              ? 'authorization-denied'
              : isConnectionUnavailable(error)
                ? 'unavailable'
                : undefined,
        message:
          error instanceof VTubeStudioApiDisabledError
            ? apiDisabledMessage
            : error instanceof VTubeStudioAuthorizationExpiredError
              ? 'VTube Studio 授权已失效，需要重新授权。'
              : isConnectionUnavailable(error)
                ? unavailableMessage
                : '无法读取 VTube Studio 模型清单；请确认 VTube Studio 已加载一个模型。',
      };
    }
  }

  public async present(
    input: VTubeStudioPresentationInput,
  ): Promise<VTubeStudioPresentationResult> {
    if (!input.state && !input.emotion && !input.action) {
      return { ok: false, reason: 'invalid-intent', message: '没有可发送的角色动作。' };
    }
    try {
      let settings = await this.store.get();
      if (!settings.enabled) {
        return { ok: false, reason: 'disabled', message: '请先启用 VTube Studio 显示。' };
      }
      const inspected =
        this.session?.isOpen && this.inventory
          ? { ok: true as const, inventory: this.inventory }
          : await this.inspect();
      const session = this.session;
      const inventory = inspected.inventory;
      if (!inspected.ok || !session?.isOpen || !inventory) {
        return {
          ok: false,
          reason: inspected.message?.includes('授权') ? 'not-authorized' : 'connection-failed',
          message: inspected.message ?? '无法连接并读取当前 VTube Studio 模型。',
        };
      }
      if (!inventory.model.loaded || !inventory.model.id) {
        return {
          ok: false,
          reason: 'model-not-loaded',
          message: 'VTube Studio 当前没有加载可用模型。',
        };
      }
      settings = await this.store.get();
      const modelMapping = resolveConfirmedModelMapping(
        settings.modelMappings ?? {},
        inventory.model.id,
      );

      let presented = false;
      let missingEmotionMapping = false;
      if (input.state) {
        this.presentationState = input.state;
        this.startIdleMotion();
        await this.sendIdleMotionFrame();
        presented = true;
      }
      if (input.emotion) {
        if (input.emotion === 'neutral') {
          const expressionState = await session.request('ExpressionStateRequest', {
            details: true,
            expressionFile: '',
          });
          inventory.expressions = parseExpressions(expressionState);
          const filesToDeactivate = new Set(
            selectControlledActiveExpressionFiles(inventory.expressions, modelMapping),
          );
          if (this.activeExpressionFile) filesToDeactivate.add(this.activeExpressionFile);
          for (const expressionFile of filesToDeactivate) {
            const response = await session.request('ExpressionActivationRequest', {
              expressionFile,
              fadeTime: 0.2,
              active: false,
            });
            assertVTubeStudioResponseType(response, 'ExpressionActivationResponse');
          }
          this.activeExpressionFile = undefined;
          presented = true;
        } else {
          const expressionState = await session.request('ExpressionStateRequest', {
            details: true,
            expressionFile: '',
          });
          inventory.expressions = parseExpressions(expressionState);
          const mappedExpressionFile = modelMapping?.emotionExpressions[input.emotion];
          const expression = mappedExpressionFile
            ? inventory.expressions.find((candidate) => candidate.file === mappedExpressionFile)
            : undefined;
          missingEmotionMapping = !expression;
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
            this.activeExpressionFile = nextFile;
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
        }
      }

      if (input.action) {
        const mappedHotkeyId = modelMapping?.actionHotkeys[input.action];
        const hotkey = mappedHotkeyId
          ? inventory.hotkeys.find((candidate) => candidate.hotkeyId === mappedHotkeyId)
          : undefined;
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
      if (!presented || (missingEmotionMapping && !input.state && !input.action)) {
        if (input.emotion && missingEmotionMapping) {
          return {
            ok: false,
            reason: 'mapping-missing',
            message: `当前模型没有可用的“${emotionLabels[input.emotion]}”表情映射。`,
          };
        }
        return {
          ok: false,
          reason: 'mapping-missing',
          message: '当前模型没有可用的动作映射。',
        };
      }
      return { ok: true, reason: 'presented' };
    } catch {
      this.disconnect();
      this.connection = 'disconnected';
      return {
        ok: false,
        reason: 'connection-failed',
        message: 'VTube Studio 连接中断，未能发送角色动作。',
      };
    }
  }

  public async previewExpression(
    input: VTubeStudioExpressionPreviewInput,
  ): Promise<VTubeStudioOperationResult> {
    try {
      const settings = await this.store.get();
      if (!settings.enabled) return { ok: false, message: '请先启用 VTube Studio 显示。' };
      const inspected =
        this.session?.isOpen && this.inventory
          ? { ok: true as const, inventory: this.inventory }
          : await this.inspect();
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

  private async connectUsingConfiguredOrDiscoveredPort(
    initialSettings: VTubeStudioSettings,
  ): Promise<{ session: VTubeStudioApiSession; settings: VTubeStudioSettings }> {
    const directSession = this.createSession(initialSettings.port);
    try {
      await directSession.connect();
      return { session: directSession, settings: initialSettings };
    } catch (directError) {
      directSession.close();
      if (!isConnectionUnavailable(directError)) throw directError;
      const discovered = await this.discoverApi().catch(() => ({ found: false as const }));
      if (!discovered.found) throw directError;
      const settings =
        initialSettings.port === discovered.port
          ? initialSettings
          : { ...initialSettings, port: discovered.port };
      if (settings !== initialSettings) await this.store.set(settings);
      if (!discovered.active) throw new VTubeStudioApiDisabledError(apiDisabledMessage);
      const discoveredSession = this.createSession(settings.port);
      try {
        await discoveredSession.connect();
        return { session: discoveredSession, settings };
      } catch (discoveredError) {
        discoveredSession.close();
        throw discoveredError;
      }
    }
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
