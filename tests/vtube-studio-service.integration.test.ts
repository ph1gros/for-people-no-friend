import { once } from 'node:events';

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';

import type { SecretStore } from '../src/main/security/secret-store';
import type { VTubeStudioConfigStore } from '../src/main/storage/vtube-studio-config-store';
import { VTubeStudioService } from '../src/main/vtube-studio/vtube-studio-service';
import type { VTubeStudioSettings } from '../src/shared/vtube-studio-ipc';

describe('VTube Studio service integration', () => {
  let server: WebSocketServer | undefined;
  let service: VTubeStudioService | undefined;

  afterEach(async () => {
    service?.dispose();
    service = undefined;
    if (server) {
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    server = undefined;
  });

  it('does not connect while disabled', async () => {
    let connections = 0;
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    server.on('connection', () => {
      connections += 1;
    });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local test port.');

    service = new VTubeStudioService(
      {
        get: async () => ({
          enabled: false,
          port: address.port,
          mouseTrackingEnabled: false,
        }),
        set: async () => undefined,
      } as VTubeStudioConfigStore,
      {
        get: async () => undefined,
        has: async () => false,
        set: async () => undefined,
      } as Pick<SecretStore, 'get' | 'has' | 'set'>,
      undefined,
      undefined,
      async () => ({ found: false }),
    );

    await expect(service.inspect()).resolves.toMatchObject({ ok: false });
    expect(connections).toBe(0);
    await expect(service.getStatus()).resolves.toMatchObject({ connection: 'disabled' });
  });

  it('does not treat an undecryptable token copied from another computer as authorized', async () => {
    service = new VTubeStudioService(
      {
        get: async () => ({
          enabled: true,
          port: 8001,
          mouseTrackingEnabled: false,
        }),
        set: async () => undefined,
      } as VTubeStudioConfigStore,
      {
        get: async () => undefined,
        has: async () => true,
        set: async () => undefined,
      } as Pick<SecretStore, 'get' | 'has' | 'set'>,
    );

    await expect(service.getStatus()).resolves.toMatchObject({
      authorized: false,
      connection: 'disconnected',
    });
  });

  it('uses the loopback VTube Studio broadcast port before requesting authorization', async () => {
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    server.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const request = JSON.parse(raw.toString()) as {
          requestID: string;
          messageType: string;
        };
        if (request.messageType !== 'AuthenticationTokenRequest') return;
        socket.send(
          JSON.stringify({
            apiName: 'VTubeStudioPublicAPI',
            apiVersion: '1.0',
            requestID: request.requestID,
            messageType: 'AuthenticationTokenResponse',
            data: { authenticationToken: 'discovered-token' },
          }),
        );
      });
    });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local test port.');

    let settings: VTubeStudioSettings = {
      enabled: true,
      port: address.port === 65_535 ? address.port - 1 : address.port + 1,
      mouseTrackingEnabled: false,
      emotionExpressions: {},
    };
    const storedTokens = new Map<string, string>();
    service = new VTubeStudioService(
      {
        get: async () => ({ ...settings }),
        set: async (next: VTubeStudioSettings) => {
          settings = { ...next };
        },
      } as VTubeStudioConfigStore,
      {
        get: async (id: string) => storedTokens.get(id),
        has: async (id: string) => storedTokens.has(id),
        set: async (id: string, value: string) => {
          storedTokens.set(id, value);
        },
      } as Pick<SecretStore, 'get' | 'has' | 'set'>,
      undefined,
      undefined,
      async () => ({ found: true, active: true, port: address.port }),
    );

    await expect(service.authorize()).resolves.toEqual({
      ok: true,
      reason: 'authorized',
      message: 'VTube Studio 已授权。',
    });
    expect(settings.port).toBe(address.port);
    expect(storedTokens.get('vtube-studio-plugin-token')).toBe('discovered-token');
  });

  it('uses the configured loopback port without waiting for optional UDP discovery', async () => {
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    server.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const request = JSON.parse(raw.toString()) as {
          requestID: string;
          messageType: string;
        };
        if (request.messageType !== 'AuthenticationTokenRequest') return;
        socket.send(
          JSON.stringify({
            apiName: 'VTubeStudioPublicAPI',
            apiVersion: '1.0',
            requestID: request.requestID,
            messageType: 'AuthenticationTokenResponse',
            data: { authenticationToken: 'direct-token' },
          }),
        );
      });
    });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local test port.');

    let discoveryCalls = 0;
    service = new VTubeStudioService(
      {
        get: async () => ({
          enabled: true,
          port: address.port,
          mouseTrackingEnabled: false,
          emotionExpressions: {},
        }),
        set: async () => undefined,
      } as VTubeStudioConfigStore,
      {
        get: async () => undefined,
        has: async () => false,
        set: async () => undefined,
      } as Pick<SecretStore, 'get' | 'has' | 'set'>,
      undefined,
      undefined,
      async () => {
        discoveryCalls += 1;
        return { found: false };
      },
    );

    await expect(service.authorize()).resolves.toMatchObject({
      ok: true,
      reason: 'authorized',
    });
    expect(discoveryCalls).toBe(0);
  });

  it('explains the one VTube Studio switch that must be enabled by the user', async () => {
    let socketCreated = false;
    let settings: VTubeStudioSettings = {
      enabled: true,
      port: 8_001,
      mouseTrackingEnabled: false,
      emotionExpressions: {},
    };
    service = new VTubeStudioService(
      {
        get: async () => ({ ...settings }),
        set: async (next: VTubeStudioSettings) => {
          settings = { ...next };
        },
      } as VTubeStudioConfigStore,
      {
        get: async () => undefined,
        has: async () => false,
        set: async () => undefined,
      } as Pick<SecretStore, 'get' | 'has' | 'set'>,
      () => {
        socketCreated = true;
        throw new Error('VTube Studio is unavailable.');
      },
      undefined,
      async () => ({ found: true, active: false, port: 9_123 }),
    );

    await expect(service.authorize()).resolves.toEqual({
      ok: false,
      reason: 'api-disabled',
      message:
        'VTube Studio 已运行，但插件接口尚未开启。请在它的设置首页打开“允许插件 API 访问”，然后回来再次连接。',
    });
    expect(socketCreated).toBe(true);
    expect(settings.port).toBe(9_123);
  });

  it('forgets a revoked saved token so the same user action can authorize again', async () => {
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    server.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const request = JSON.parse(raw.toString()) as {
          requestID: string;
          messageType: string;
        };
        if (request.messageType !== 'AuthenticationRequest') return;
        socket.send(
          JSON.stringify({
            apiName: 'VTubeStudioPublicAPI',
            apiVersion: '1.0',
            requestID: request.requestID,
            messageType: 'AuthenticationResponse',
            data: { authenticated: false, reason: 'Token revoked.' },
          }),
        );
      });
    });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local test port.');
    const secrets = new Map([['vtube-studio-plugin-token', 'stale-token']]);
    service = new VTubeStudioService(
      {
        get: async () => ({
          enabled: true,
          port: address.port,
          mouseTrackingEnabled: false,
        }),
        set: async () => undefined,
      } as VTubeStudioConfigStore,
      {
        get: async (id: string) => secrets.get(id),
        has: async (id: string) => secrets.has(id),
        set: async (id: string, value: string) => {
          secrets.set(id, value);
        },
        delete: async (id: string) => {
          secrets.delete(id);
        },
      } as Pick<SecretStore, 'get' | 'has' | 'set' | 'delete'>,
      undefined,
      undefined,
      async () => ({ found: false }),
    );

    await expect(service.inspect()).resolves.toEqual({
      ok: false,
      reason: 'authorization-denied',
      message: 'VTube Studio 授权已失效，需要重新授权。',
    });
    await expect(service.getStatus()).resolves.toMatchObject({ authorized: false });
  });

  it('authorizes and reads model metadata sequentially from loopback', async () => {
    const requestTypes: string[] = [];
    const expressionActivations: Record<string, unknown>[] = [];
    const injectedFrames: Record<string, unknown>[] = [];
    const activeExpressions = new Set<string>();
    let currentModelLoaded = true;
    let currentModelId = 'model-id';
    let currentModelName = 'akari';
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    server.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const request = JSON.parse(raw.toString()) as {
          requestID: string;
          messageType: string;
          data?: Record<string, unknown>;
        };
        requestTypes.push(request.messageType);
        let messageType = '';
        let data: Record<string, unknown> = {};
        if (request.messageType === 'AuthenticationTokenRequest') {
          expect(request.data).toMatchObject({
            pluginName: 'For People No Friend',
            pluginDeveloper: 'ph1gros',
          });
          messageType = 'AuthenticationTokenResponse';
          data = { authenticationToken: 'fake-vtube-studio-token' };
        } else if (request.messageType === 'AuthenticationRequest') {
          expect(request.data?.authenticationToken).toBe('fake-vtube-studio-token');
          messageType = 'AuthenticationResponse';
          data = { authenticated: true, reason: 'Token valid.' };
        } else if (request.messageType === 'CurrentModelRequest') {
          messageType = 'CurrentModelResponse';
          data = {
            modelLoaded: currentModelLoaded,
            modelName: currentModelLoaded ? currentModelName : '',
            modelID: currentModelLoaded ? currentModelId : '',
            vtsModelName: 'akari.vtube.json',
            live2DModelName: 'akari.model3.json',
            numberOfLive2DParameters: 206,
            numberOfLive2DArtmeshes: 283,
            numberOfTextures: 1,
            textureResolution: 4096,
          };
        } else if (request.messageType === 'HotkeysInCurrentModelRequest') {
          messageType = 'HotkeysInCurrentModelResponse';
          data = {
            availableHotkeys: [
              {
                name: 'Heart Eyes',
                type: 'ToggleExpression',
                file: 'EyesLove.exp3.json',
                hotkeyID: 'heart-eyes',
                onScreenButtonID: 1,
              },
            ],
          };
        } else if (request.messageType === 'ExpressionStateRequest') {
          messageType = 'ExpressionStateResponse';
          data = {
            expressions: [
              {
                name: 'EyesLove',
                file: 'EyesLove.exp3.json',
                active: activeExpressions.has('EyesLove.exp3.json'),
                deactivateWhenKeyIsLetGo: false,
                usedInHotkeys: [{ name: 'Heart Eyes', id: 'heart-eyes' }],
                parameters: [{ name: 'EyesLove', value: 1 }],
              },
              {
                name: 'SignAngry',
                file: 'SignAngry.exp3.json',
                active: activeExpressions.has('SignAngry.exp3.json'),
                deactivateWhenKeyIsLetGo: false,
                usedInHotkeys: [],
                parameters: [{ name: 'SignAngry', value: 1 }],
              },
            ],
          };
        } else if (request.messageType === 'Live2DParameterListRequest') {
          messageType = 'Live2DParameterListResponse';
          data = {
            modelLoaded: true,
            modelName: 'akari',
            modelID: 'model-id',
            parameters: [
              { name: 'EyesLove', value: 0, min: 0, max: 1, defaultValue: 0 },
              { name: 'SignAngry', value: 0, min: 0, max: 1, defaultValue: 0 },
            ],
          };
        } else if (request.messageType === 'ExpressionActivationRequest') {
          expressionActivations.push(request.data ?? {});
          const expressionFile = String(request.data?.expressionFile ?? '');
          if (request.data?.active === true) activeExpressions.add(expressionFile);
          else activeExpressions.delete(expressionFile);
          messageType = 'ExpressionActivationResponse';
        } else if (request.messageType === 'InjectParameterDataRequest') {
          injectedFrames.push(request.data ?? {});
          messageType = 'InjectParameterDataResponse';
        }
        socket.send(
          JSON.stringify({
            apiName: 'VTubeStudioPublicAPI',
            apiVersion: '1.0',
            requestID: request.requestID,
            messageType,
            data,
          }),
        );
      });
    });
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local test port.');

    let settings: VTubeStudioSettings = {
      enabled: true,
      port: address.port,
      mouseTrackingEnabled: true,
    };
    const secrets = new Map<string, string>();
    service = new VTubeStudioService(
      {
        get: async () => ({ ...settings }),
        set: async (next: VTubeStudioSettings) => {
          settings = { ...next };
        },
      } as VTubeStudioConfigStore,
      {
        get: async (id: string) => secrets.get(id),
        has: async (id: string) => secrets.has(id),
        set: async (id: string, value: string) => {
          secrets.set(id, value);
        },
      } as Pick<SecretStore, 'get' | 'has' | 'set'>,
      undefined,
      () => ({ x: 0.5, y: -0.5 }),
      async () => ({ found: false }),
    );

    await expect(service.authorize()).resolves.toEqual({
      ok: true,
      reason: 'authorized',
      message: 'VTube Studio 已授权。',
    });
    const [firstInspection, concurrentInspection] = await Promise.all([
      service.inspect(),
      service.inspect(),
    ]);
    expect(firstInspection).toMatchObject({
      ok: true,
      inventory: {
        model: { name: 'akari', parameterCount: 206 },
        hotkeys: [{ name: 'Heart Eyes', hotkeyId: 'heart-eyes' }],
        expressions: [
          { name: 'EyesLove', active: false, parameters: [{ name: 'EyesLove', value: 1 }] },
          { name: 'SignAngry', active: false, parameters: [{ name: 'SignAngry', value: 1 }] },
        ],
        parameters: [
          { name: 'EyesLove', minimum: 0, maximum: 1 },
          { name: 'SignAngry', minimum: 0, maximum: 1 },
        ],
      },
      mapping: {
        modelId: 'model-id',
        confirmed: undefined,
        suggestions: {
          emotionExpressions: {
            happy: 'EyesLove.exp3.json',
            angry: 'SignAngry.exp3.json',
          },
        },
      },
    });
    expect(concurrentInspection).toEqual(firstInspection);
    await expect(
      service.setSettings({
        ...settings,
        emotionExpressions: {},
        modelMappings: {
          'model-id': {
            modelName: 'akari',
            emotionExpressions: {
              happy: 'EyesLove.exp3.json',
              angry: 'SignAngry.exp3.json',
            },
            actionHotkeys: {},
          },
        },
      }),
    ).resolves.toEqual({ ok: true });
    const requestsBeforeRefresh = requestTypes.length;
    await expect(service.inspect()).resolves.toMatchObject({ ok: true });
    expect(requestTypes.slice(requestsBeforeRefresh)).toEqual([
      'CurrentModelRequest',
      'HotkeysInCurrentModelRequest',
      'ExpressionStateRequest',
      'Live2DParameterListRequest',
    ]);
    await expect(service.present({ emotion: 'happy' })).resolves.toMatchObject({
      ok: true,
      reason: 'presented',
    });
    await expect(service.present({ emotion: 'happy' })).resolves.toMatchObject({
      ok: true,
      reason: 'presented',
    });
    await expect(service.present({ emotion: 'angry' })).resolves.toMatchObject({
      ok: true,
      reason: 'presented',
    });
    expect([
      ...requestTypes.slice(0, requestsBeforeRefresh),
      ...requestTypes.slice(requestsBeforeRefresh + 4),
    ]).toEqual([
      'AuthenticationTokenRequest',
      'AuthenticationRequest',
      'CurrentModelRequest',
      'HotkeysInCurrentModelRequest',
      'ExpressionStateRequest',
      'Live2DParameterListRequest',
      'ExpressionStateRequest',
      'ExpressionActivationRequest',
      'ExpressionStateRequest',
      'ExpressionStateRequest',
      'ExpressionActivationRequest',
      'ExpressionActivationRequest',
    ]);
    expect(expressionActivations).toEqual([
      { expressionFile: 'EyesLove.exp3.json', fadeTime: 0.2, active: true },
      { expressionFile: 'EyesLove.exp3.json', fadeTime: 0.2, active: false },
      { expressionFile: 'SignAngry.exp3.json', fadeTime: 0.2, active: true },
    ]);
    const requestsBeforeMappingSave = requestTypes.length;
    await expect(
      service.setSettings({
        ...settings,
        modelMappings: {
          ...settings.modelMappings,
          'model-id': {
            modelName: 'akari',
            emotionExpressions: {
              happy: 'EyesLove.exp3.json',
              angry: 'SignAngry.exp3.json',
              neutral: 'EyesLove.exp3.json',
            },
            actionHotkeys: {},
          },
        },
      }),
    ).resolves.toEqual({ ok: true });
    await expect(service.present({ emotion: 'happy' })).resolves.toMatchObject({
      ok: true,
      reason: 'presented',
    });
    expect(requestTypes.slice(requestsBeforeMappingSave)).not.toContain('AuthenticationRequest');
    await expect(
      service.previewExpression({ active: true, expressionIndex: 0 }),
    ).resolves.toMatchObject({ ok: true });
    await expect(service.previewExpression({ active: false })).resolves.toMatchObject({ ok: true });
    expect(expressionActivations.slice(-3)).toEqual([
      { expressionFile: 'SignAngry.exp3.json', fadeTime: 0.2, active: false },
      { expressionFile: 'EyesLove.exp3.json', fadeTime: 0.2, active: true },
      { expressionFile: 'EyesLove.exp3.json', fadeTime: 0.2, active: false },
    ]);
    await expect(service.present({ emotion: 'surprised' })).resolves.toEqual({
      ok: false,
      reason: 'mapping-missing',
      message: '当前模型没有可用的“惊讶”表情映射。',
    });
    await expect(service.getStatus()).resolves.toMatchObject({
      connection: 'connected',
      authorized: true,
    });
    service.setDisplayTransportDiagnostic('FPNF_SPOUT_FRAME_UNAVAILABLE');
    await expect(service.getStatus()).resolves.toMatchObject({
      detail:
        'VTube Studio API 已连接，但 Spout2 模型画面无法接收；请让 VTube Studio 与桌宠使用同一块高性能显卡。',
    });
    await expect(service.present({ state: 'idle' })).resolves.toMatchObject({
      ok: true,
      reason: 'presented',
    });
    await expect(service.present({ action: 'nod' })).resolves.toMatchObject({
      ok: true,
      reason: 'presented',
    });
    expect(injectedFrames).toHaveLength(2);
    expect(injectedFrames[0]).toMatchObject({
      mode: 'set',
      parameterValues: [
        { id: 'FaceAngleX' },
        { id: 'FaceAngleY' },
        { id: 'FaceAngleZ' },
        { id: 'EyeRightX', value: -0.25 },
        { id: 'EyeRightY', value: -0.17 },
        { id: 'EyeOpenLeft', value: 0.8 },
        { id: 'EyeOpenRight', value: 0.8 },
      ],
    });
    currentModelId = 'model-id-2';
    currentModelName = 'other-model';
    await expect(service.inspect()).resolves.toMatchObject({
      ok: true,
      mapping: { modelId: 'model-id-2', confirmed: undefined },
    });
    await expect(service.present({ emotion: 'happy' })).resolves.toEqual({
      ok: false,
      reason: 'mapping-missing',
      message: '当前模型没有可用的“开心”表情映射。',
    });
    currentModelLoaded = false;
    await expect(service.inspect()).resolves.toEqual({
      ok: false,
      message: 'VTube Studio 当前没有加载可读取的模型。',
    });
  });
});
