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
    );

    await expect(service.inspect()).resolves.toMatchObject({ ok: false });
    expect(connections).toBe(0);
    await expect(service.getStatus()).resolves.toMatchObject({ connection: 'disabled' });
  });

  it('authorizes and reads model metadata sequentially from loopback', async () => {
    const requestTypes: string[] = [];
    const expressionActivations: Record<string, unknown>[] = [];
    const injectedFrames: Record<string, unknown>[] = [];
    const activeExpressions = new Set<string>();
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
            modelLoaded: true,
            modelName: 'akari',
            modelID: 'model-id',
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
    );

    await expect(service.authorize()).resolves.toEqual({
      ok: true,
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
    });
    expect(concurrentInspection).toEqual(firstInspection);
    await expect(service.present({ emotion: 'happy' })).resolves.toBe(true);
    await expect(service.present({ emotion: 'happy' })).resolves.toBe(true);
    await expect(service.present({ emotion: 'angry' })).resolves.toBe(true);
    expect(requestTypes).toEqual([
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
    await expect(
      service.previewExpression({ active: true, expressionIndex: 0 }),
    ).resolves.toMatchObject({ ok: true });
    await expect(service.previewExpression({ active: false })).resolves.toMatchObject({ ok: true });
    expect(expressionActivations.slice(-3)).toEqual([
      { expressionFile: 'SignAngry.exp3.json', fadeTime: 0.2, active: false },
      { expressionFile: 'EyesLove.exp3.json', fadeTime: 0.2, active: true },
      { expressionFile: 'EyesLove.exp3.json', fadeTime: 0.2, active: false },
    ]);
    await expect(service.getStatus()).resolves.toMatchObject({
      connection: 'connected',
      authorized: true,
    });
    await expect(service.present({ state: 'idle' })).resolves.toBe(true);
    await expect(service.present({ action: 'nod' })).resolves.toBe(true);
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
  });
});
