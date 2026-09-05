/**
 * Environment allow-lists for spawned child processes.
 *
 * A child inherits nothing it was not explicitly given. Passing `...process.env` hands a child
 * every variable the user's machine happens to hold — other applications' API keys, proxy
 * credentials, internal hostnames — and any dependency inside that child (a telemetry hook, a
 * crash reporter, a verbose log) can carry them off. The bundled Python runtimes pull in a large
 * third-party dependency tree, so they get a list rather than the whole environment.
 *
 * Names are matched case-insensitively: Windows environment variables are case-insensitive, and
 * the real casing varies between machines (`Path` vs `PATH`, `TEMP` vs `Temp`).
 */

/** Enough for a package manager script: paths, temp space, and the user profile. */
export const MINIMAL_CHILD_ENV_NAMES: readonly string[] = [
  'APPDATA',
  'ComSpec',
  'HOME',
  'LOCALAPPDATA',
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'WINDIR',
];

/**
 * Additionally what an embedded CPython with ONNX Runtime needs on Windows.
 *
 * `SystemRoot`/`SystemDrive` are required to load system DLLs at all; the processor and program
 * directories let ONNX Runtime size its thread pools and locate DirectML's system dependencies.
 * None of these carry credentials.
 */
export const PYTHON_RUNTIME_ENV_NAMES: readonly string[] = [
  ...MINIMAL_CHILD_ENV_NAMES,
  'COMMONPROGRAMFILES',
  'HOMEDRIVE',
  'HOMEPATH',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'PROGRAMDATA',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'SystemDrive',
];

/**
 * Copy only the allowed variables out of the current environment.
 *
 * `overrides` are applied afterwards and are not filtered — they are values this process chose,
 * such as a service root or a session token, not values inherited from the user's machine.
 */
export const createChildEnvironment = (
  allowed: readonly string[],
  overrides: NodeJS.ProcessEnv = {},
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => {
  const permitted = new Set(allowed.map((name) => name.toLowerCase()));
  const result: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && permitted.has(name.toLowerCase())) result[name] = value;
  }
  return { ...result, ...overrides };
};
