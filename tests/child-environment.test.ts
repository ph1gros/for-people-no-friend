import { describe, expect, it } from 'vitest';

import {
  createChildEnvironment,
  MINIMAL_CHILD_ENV_NAMES,
  PYTHON_RUNTIME_ENV_NAMES,
} from '../src/main/security/child-environment';

describe('createChildEnvironment', () => {
  it('passes through only allowed names', () => {
    const result = createChildEnvironment(
      ['PATH', 'TEMP'],
      {},
      {
        PATH: '/usr/bin',
        TEMP: '/tmp',
        OPENAI_API_KEY: 'sk-must-not-leak',
        AWS_SECRET_ACCESS_KEY: 'must-not-leak',
        HTTP_PROXY: 'http://corp.internal:8080',
      },
    );

    expect(result).toEqual({ PATH: '/usr/bin', TEMP: '/tmp' });
  });

  it('matches names case-insensitively, as Windows does', () => {
    // Real machines report `Path`, `Temp`, `SystemRoot` with varying casing.
    const result = createChildEnvironment(
      ['PATH', 'SystemRoot'],
      {},
      {
        Path: 'C:\\Windows\\System32',
        systemroot: 'C:\\Windows',
      },
    );

    expect(result).toEqual({ Path: 'C:\\Windows\\System32', systemroot: 'C:\\Windows' });
  });

  it('applies overrides without filtering them', () => {
    // Overrides are values this process chose — a service root, a session token — not values
    // inherited from the user's machine, so the allow-list does not apply to them.
    const result = createChildEnvironment(
      ['PATH'],
      { FPNF_SESSION_TOKEN: 'abc' },
      { PATH: '/bin' },
    );

    expect(result).toEqual({ PATH: '/bin', FPNF_SESSION_TOKEN: 'abc' });
  });

  it('lets an override replace an inherited value', () => {
    const result = createChildEnvironment(['PATH'], { PATH: '/replaced' }, { PATH: '/inherited' });

    expect(result.PATH).toBe('/replaced');
  });

  it('drops variables whose value is undefined', () => {
    const result = createChildEnvironment(['PATH', 'TEMP'], {}, { PATH: '/bin', TEMP: undefined });

    expect(Object.hasOwn(result, 'TEMP')).toBe(false);
  });

  it('gives the Python runtimes what an embedded CPython needs on Windows', () => {
    // Missing SystemRoot or PATH prevents the interpreter from loading system DLLs at all.
    for (const required of ['PATH', 'SystemRoot', 'TEMP', 'SystemDrive', 'NUMBER_OF_PROCESSORS']) {
      expect(PYTHON_RUNTIME_ENV_NAMES).toContain(required);
    }
    expect(PYTHON_RUNTIME_ENV_NAMES).toEqual(expect.arrayContaining([...MINIMAL_CHILD_ENV_NAMES]));
  });

  it('never allows a credential-shaped name through either list', () => {
    const forbidden = /key|token|secret|password|credential/i;
    for (const name of PYTHON_RUNTIME_ENV_NAMES) {
      expect(name).not.toMatch(forbidden);
    }
  });
});
