import { describe, expect, it } from 'vitest';

import {
  buildVTubeStudioInventory,
  buildVTubeStudioRequest,
  parseVTubeStudioResponse,
} from '../src/main/vtube-studio/vtube-studio-protocol';

const response = (requestID: string, messageType: string, data: Record<string, unknown>) =>
  parseVTubeStudioResponse(
    JSON.stringify({
      apiName: 'VTubeStudioPublicAPI',
      apiVersion: '1.0',
      requestID,
      messageType,
      data,
    }),
  );

describe('VTube Studio protocol', () => {
  it('builds fixed API envelopes', () => {
    expect(buildVTubeStudioRequest('request-1', 'CurrentModelRequest')).toEqual({
      apiName: 'VTubeStudioPublicAPI',
      apiVersion: '1.0',
      requestID: 'request-1',
      messageType: 'CurrentModelRequest',
    });
  });

  it('parses a bounded read-only inventory', () => {
    expect(
      buildVTubeStudioInventory(
        response('model', 'CurrentModelResponse', {
          modelLoaded: true,
          modelName: 'akari',
          modelID: 'model-id',
          vtsModelName: 'akari.vtube.json',
          live2DModelName: 'akari.model3.json',
          numberOfLive2DParameters: 206,
          numberOfLive2DArtmeshes: 283,
          numberOfTextures: 1,
          textureResolution: 4096,
        }),
        response('hotkeys', 'HotkeysInCurrentModelResponse', {
          availableHotkeys: [
            {
              name: 'Heart Eyes',
              type: 'ToggleExpression',
              file: 'EyesLove.exp3.json',
              hotkeyID: 'hotkey-id',
              onScreenButtonID: 1,
            },
          ],
        }),
        response('expressions', 'ExpressionStateResponse', {
          expressions: [
            {
              name: 'EyesLove',
              file: 'EyesLove.exp3.json',
              active: false,
              deactivateWhenKeyIsLetGo: false,
              usedInHotkeys: [{ name: '害羞', id: 'shy-hotkey' }],
              parameters: [{ name: '害羞', value: 1 }],
            },
          ],
        }),
        response('parameters', 'Live2DParameterListResponse', {
          modelLoaded: true,
          modelName: 'akari',
          modelID: 'model-id',
          parameters: [{ name: '害羞', value: 0, min: 0, max: 1, defaultValue: 0 }],
        }),
      ),
    ).toMatchObject({
      model: { name: 'akari', parameterCount: 206 },
      hotkeys: [{ name: 'Heart Eyes', hotkeyId: 'hotkey-id' }],
      expressions: [
        {
          name: 'EyesLove',
          active: false,
          parameters: [{ name: '害羞', value: 1 }],
          hotkeyNames: ['害羞'],
        },
      ],
      parameters: [{ name: '害羞', minimum: 0, maximum: 1 }],
    });
  });

  it('rejects path-like filenames and oversized payloads', () => {
    expect(() =>
      buildVTubeStudioInventory(
        response('model', 'CurrentModelResponse', {
          modelLoaded: true,
          modelName: 'akari',
          modelID: 'model-id',
          vtsModelName: '..\\akari.vtube.json',
          live2DModelName: 'akari.model3.json',
          numberOfLive2DParameters: 1,
          numberOfLive2DArtmeshes: 1,
          numberOfTextures: 1,
          textureResolution: 4096,
        }),
        response('hotkeys', 'HotkeysInCurrentModelResponse', { availableHotkeys: [] }),
        response('expressions', 'ExpressionStateResponse', { expressions: [] }),
        response('parameters', 'Live2DParameterListResponse', { parameters: [] }),
      ),
    ).toThrow();
    expect(() => parseVTubeStudioResponse('x'.repeat(1_048_577))).toThrow();
  });
});
