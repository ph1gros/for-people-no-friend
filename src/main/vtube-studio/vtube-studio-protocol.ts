import type {
  VTubeStudioExpressionSummary,
  VTubeStudioHotkeySummary,
  VTubeStudioInventory,
  VTubeStudioModelSummary,
  VTubeStudioParameterSummary,
} from '../../shared/vtube-studio-ipc';

export const VTUBE_STUDIO_API_NAME = 'VTubeStudioPublicAPI';
export const VTUBE_STUDIO_API_VERSION = '1.0';
export const VTUBE_STUDIO_PLUGIN_NAME = 'For People No Friend';
export const VTUBE_STUDIO_PLUGIN_DEVELOPER = 'ph1gros';
export const MAX_VTUBE_STUDIO_RESPONSE_BYTES = 1_048_576;

const MAX_SUMMARY_TEXT_LENGTH = 256;
const MAX_HOTKEYS = 256;
const MAX_EXPRESSIONS = 256;
const MAX_PARAMETERS = 2_048;
const SAFE_FILE_PATTERN = /^[^\\/]{0,256}$/;

export interface VTubeStudioRequest {
  apiName: typeof VTUBE_STUDIO_API_NAME;
  apiVersion: typeof VTUBE_STUDIO_API_VERSION;
  requestID: string;
  messageType: string;
  data?: Record<string, unknown>;
}

export interface VTubeStudioResponse {
  requestID: string;
  messageType: string;
  data: Record<string, unknown>;
}

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
};

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });

const asString = (value: unknown, label: string, allowEmpty = true): string => {
  if (
    typeof value !== 'string' ||
    value.length > MAX_SUMMARY_TEXT_LENGTH ||
    (!allowEmpty && value.length === 0) ||
    hasControlCharacter(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
};

const asFileName = (value: unknown, label: string): string => {
  const file = asString(value, label);
  if (!SAFE_FILE_PATTERN.test(file) || file === '.' || file === '..') {
    throw new Error(`${label} is invalid.`);
  }
  return file;
};

const asInteger = (value: unknown, label: string, minimum = 0, maximum = 1_000_000): number => {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value as number;
};

const asBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') throw new Error(`${label} is invalid.`);
  return value;
};

const asNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
};

export const buildVTubeStudioRequest = (
  requestID: string,
  messageType: string,
  data?: Record<string, unknown>,
): VTubeStudioRequest => ({
  apiName: VTUBE_STUDIO_API_NAME,
  apiVersion: VTUBE_STUDIO_API_VERSION,
  requestID,
  messageType,
  ...(data ? { data } : {}),
});

export const parseVTubeStudioResponse = (text: string): VTubeStudioResponse => {
  if (Buffer.byteLength(text, 'utf8') > MAX_VTUBE_STUDIO_RESPONSE_BYTES) {
    throw new Error('The VTube Studio response is too large.');
  }
  const record = asRecord(JSON.parse(text) as unknown, 'VTube Studio response');
  if (record.apiName !== VTUBE_STUDIO_API_NAME || record.apiVersion !== VTUBE_STUDIO_API_VERSION) {
    throw new Error('The VTube Studio response uses an unsupported protocol.');
  }
  const requestID = asString(record.requestID, 'VTube Studio request ID', false);
  const messageType = asString(record.messageType, 'VTube Studio message type', false);
  const data = asRecord(record.data ?? {}, 'VTube Studio response data');
  return { requestID, messageType, data };
};

export const readAuthenticationToken = (response: VTubeStudioResponse): string => {
  if (response.messageType !== 'AuthenticationTokenResponse') {
    throw new Error('VTube Studio authorization was not accepted.');
  }
  const token = asString(response.data.authenticationToken, 'VTube Studio token', false);
  if (token.length > 64 || !/^[\x20-\x7e]+$/.test(token)) {
    throw new Error('VTube Studio returned an invalid token.');
  }
  return token;
};

export const assertAuthenticated = (response: VTubeStudioResponse): void => {
  if (
    response.messageType !== 'AuthenticationResponse' ||
    !asBoolean(response.data.authenticated, 'VTube Studio authentication result')
  ) {
    throw new Error('VTube Studio rejected the saved authorization.');
  }
};

export const throwIfVTubeStudioError = (response: VTubeStudioResponse): void => {
  if (response.messageType !== 'APIError') return;
  const errorID = asInteger(response.data.errorID, 'VTube Studio error ID', 0, 100_000);
  throw new Error(`VTube Studio API error ${errorID}.`);
};

export const assertVTubeStudioResponseType = (
  response: VTubeStudioResponse,
  expectedMessageType: string,
): void => {
  throwIfVTubeStudioError(response);
  if (response.messageType !== expectedMessageType) {
    throw new Error('VTube Studio returned an unexpected response type.');
  }
};

export const parseCurrentModel = (response: VTubeStudioResponse): VTubeStudioModelSummary => {
  throwIfVTubeStudioError(response);
  if (response.messageType !== 'CurrentModelResponse') {
    throw new Error('VTube Studio returned an unexpected model response.');
  }
  return {
    loaded: asBoolean(response.data.modelLoaded, 'VTube Studio model state'),
    name: asString(response.data.modelName, 'VTube Studio model name'),
    id: asString(response.data.modelID, 'VTube Studio model ID'),
    vtsModelName: asFileName(response.data.vtsModelName, 'VTube Studio model settings file'),
    live2DModelName: asFileName(response.data.live2DModelName, 'VTube Studio Live2D model file'),
    parameterCount: asInteger(
      response.data.numberOfLive2DParameters,
      'VTube Studio parameter count',
    ),
    artmeshCount: asInteger(response.data.numberOfLive2DArtmeshes, 'VTube Studio ArtMesh count'),
    textureCount: asInteger(response.data.numberOfTextures, 'VTube Studio texture count'),
    textureResolution: asInteger(
      response.data.textureResolution,
      'VTube Studio texture resolution',
      0,
      65_536,
    ),
  };
};

export const parseHotkeys = (response: VTubeStudioResponse): VTubeStudioHotkeySummary[] => {
  throwIfVTubeStudioError(response);
  if (response.messageType !== 'HotkeysInCurrentModelResponse') {
    throw new Error('VTube Studio returned an unexpected hotkey response.');
  }
  if (
    !Array.isArray(response.data.availableHotkeys) ||
    response.data.availableHotkeys.length > MAX_HOTKEYS
  ) {
    throw new Error('VTube Studio returned an invalid hotkey list.');
  }
  return response.data.availableHotkeys.map((value) => {
    const hotkey = asRecord(value, 'VTube Studio hotkey');
    return {
      name: asString(hotkey.name, 'VTube Studio hotkey name'),
      type: asString(hotkey.type, 'VTube Studio hotkey type', false),
      file: asFileName(hotkey.file, 'VTube Studio hotkey file'),
      hotkeyId: asString(hotkey.hotkeyID, 'VTube Studio hotkey ID', false),
      onScreenButtonId: asInteger(
        hotkey.onScreenButtonID,
        'VTube Studio on-screen button ID',
        -1,
        1_024,
      ),
    };
  });
};

export const parseExpressions = (response: VTubeStudioResponse): VTubeStudioExpressionSummary[] => {
  throwIfVTubeStudioError(response);
  if (response.messageType !== 'ExpressionStateResponse') {
    throw new Error('VTube Studio returned an unexpected expression response.');
  }
  if (
    !Array.isArray(response.data.expressions) ||
    response.data.expressions.length > MAX_EXPRESSIONS
  ) {
    throw new Error('VTube Studio returned an invalid expression list.');
  }
  return response.data.expressions.map((value) => {
    const expression = asRecord(value, 'VTube Studio expression');
    const rawParameters = expression.parameters ?? [];
    const rawHotkeys = expression.usedInHotkeys ?? [];
    if (
      !Array.isArray(rawParameters) ||
      rawParameters.length > MAX_PARAMETERS ||
      !Array.isArray(rawHotkeys) ||
      rawHotkeys.length > MAX_HOTKEYS
    ) {
      throw new Error('VTube Studio returned invalid expression details.');
    }
    return {
      name: asString(expression.name, 'VTube Studio expression name'),
      file: asFileName(expression.file, 'VTube Studio expression file'),
      active: asBoolean(expression.active, 'VTube Studio expression state'),
      deactivateWhenKeyIsLetGo: asBoolean(
        expression.deactivateWhenKeyIsLetGo,
        'VTube Studio expression release state',
      ),
      parameters: rawParameters.map((value) => {
        const parameter = asRecord(value, 'VTube Studio expression parameter');
        return {
          name: asString(parameter.name, 'VTube Studio expression parameter name', false),
          value: asNumber(parameter.value, 'VTube Studio expression parameter value'),
        };
      }),
      hotkeyNames: rawHotkeys
        .map((value) => {
          const hotkey = asRecord(value, 'VTube Studio expression hotkey');
          return asString(hotkey.name, 'VTube Studio expression hotkey name');
        })
        .filter((name) => name.length > 0),
    };
  });
};

export const parseLive2DParameters = (
  response: VTubeStudioResponse,
): VTubeStudioParameterSummary[] => {
  throwIfVTubeStudioError(response);
  if (response.messageType !== 'Live2DParameterListResponse') {
    throw new Error('VTube Studio returned an unexpected parameter response.');
  }
  if (
    !Array.isArray(response.data.parameters) ||
    response.data.parameters.length > MAX_PARAMETERS
  ) {
    throw new Error('VTube Studio returned an invalid parameter list.');
  }
  return response.data.parameters.map((value) => {
    const parameter = asRecord(value, 'VTube Studio parameter');
    return {
      name: asString(parameter.name, 'VTube Studio parameter name', false),
      value: asNumber(parameter.value, 'VTube Studio parameter value'),
      minimum: asNumber(parameter.min, 'VTube Studio parameter minimum'),
      maximum: asNumber(parameter.max, 'VTube Studio parameter maximum'),
      defaultValue: asNumber(parameter.defaultValue, 'VTube Studio parameter default'),
    };
  });
};

export const buildVTubeStudioInventory = (
  modelResponse: VTubeStudioResponse,
  hotkeysResponse: VTubeStudioResponse,
  expressionsResponse: VTubeStudioResponse,
  parametersResponse: VTubeStudioResponse,
): VTubeStudioInventory => ({
  model: parseCurrentModel(modelResponse),
  hotkeys: parseHotkeys(hotkeysResponse),
  expressions: parseExpressions(expressionsResponse),
  parameters: parseLive2DParameters(parametersResponse),
});
