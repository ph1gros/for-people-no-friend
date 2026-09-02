import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createProjectCheckRunner } from '../src/main/assistant/project-check-runner';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('controlled project check runner', () => {
  it('uses a fixed package-manager command and a scrubbed environment', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-project-check-'));
    temporaryDirectories.push(directory);
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run' } }),
    );
    await writeFile(path.join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    const calls: Array<{ executable: string; args: readonly string[]; env: NodeJS.ProcessEnv }> =
      [];
    const runner = createProjectCheckRunner(async (executable, args, options) => {
      calls.push({ executable, args, env: options.env });
      return { stdout: '10 tests passed', stderr: '', exitCode: 0 };
    });

    const result = await runner(directory, 'test');

    expect(calls).toHaveLength(1);
    if (process.platform === 'win32') {
      expect(path.basename(calls[0]?.executable ?? '').toLowerCase()).toBe('cmd.exe');
      expect(calls[0]?.args).toEqual(['/d', '/s', '/c', 'pnpm.cmd', 'run', 'test']);
    } else {
      expect(calls[0]?.executable).toBe('pnpm');
      expect(calls[0]?.args).toEqual(['run', 'test']);
    }
    expect(calls[0]?.env.CI).toBe('1');
    expect(Object.keys(calls[0]?.env ?? {})).not.toContain('OPENAI_API_KEY');
    expect(result).toContain('test 检查通过');
    expect(result).toContain('10 tests passed');
  });

  it('refuses a check that is not declared in package.json', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'fpnf-project-check-'));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ scripts: {} }));
    await writeFile(path.join(directory, 'package-lock.json'), '{}');
    const runner = createProjectCheckRunner(async () => {
      throw new Error('must not execute');
    });

    await expect(runner(directory, 'build')).rejects.toThrow('没有 build 脚本');
  });
});
