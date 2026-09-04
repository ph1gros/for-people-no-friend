import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export type ProjectCheck = 'test' | 'lint' | 'typecheck' | 'build';

export interface ProjectCheckPlan {
  check: ProjectCheck;
  manager: 'pnpm' | 'npm' | 'yarn';
  fingerprint: string;
  scripts: Array<{ name: string; command: string }>;
}

export interface ProjectCheckRunner {
  inspect(root: string, check: ProjectCheck): Promise<ProjectCheckPlan>;
  run(root: string, plan: ProjectCheckPlan, signal?: AbortSignal): Promise<string>;
}

type ExecFileResult = { stdout: string; stderr: string; exitCode: number | null };
type ExecFileImplementation = (
  executable: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    timeout: number;
    maxBuffer: number;
    windowsHide: boolean;
  },
) => Promise<ExecFileResult>;

const MAX_PACKAGE_BYTES = 1_000_000;
const MAX_CHECK_OUTPUT_CHARACTERS = 32_000;

const isOutside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
};

const safeChildEnvironment = (): NodeJS.ProcessEnv => {
  const result: NodeJS.ProcessEnv = {};
  const safeNames = new Set([
    'APPDATA',
    'ComSpec',
    'HOME',
    'LOCALAPPDATA',
    'Path',
    'PATH',
    'PATHEXT',
    'SystemRoot',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'WINDIR',
  ]);
  for (const [name, value] of Object.entries(process.env)) {
    if (safeNames.has(name) && value !== undefined) result[name] = value;
  }
  result.CI = '1';
  return result;
};

const defaultExecFile: ExecFileImplementation = (executable, args, options) =>
  new Promise((resolve) => {
    execFile(
      executable,
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        signal: options.signal,
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        windowsHide: options.windowsHide,
        shell: false,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        const exitCode =
          error && typeof error === 'object' && 'code' in error && typeof error.code === 'number'
            ? error.code
            : error
              ? null
              : 0;
        resolve({ stdout, stderr, exitCode });
      },
    );
  });

const fileExists = async (target: string): Promise<boolean> => {
  try {
    return (await lstat(target)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};

const inspectProjectCheck = async (
  root: string,
  check: ProjectCheck,
): Promise<ProjectCheckPlan> => {
  const realRoot = await realpath(root);
  const packagePath = path.join(realRoot, 'package.json');
  const packageInfo = await lstat(packagePath);
  if (
    packageInfo.isSymbolicLink() ||
    !packageInfo.isFile() ||
    packageInfo.size > MAX_PACKAGE_BYTES
  ) {
    throw new Error('工作区根目录没有可安全读取的 package.json。');
  }
  const realPackagePath = await realpath(packagePath);
  if (isOutside(realRoot, realPackagePath)) throw new Error('package.json 超出工作区。');
  const parsed = JSON.parse(await readFile(realPackagePath, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('package.json 格式无效。');
  }
  const scripts = 'scripts' in parsed ? parsed.scripts : undefined;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    throw new Error('package.json 没有 scripts。');
  }
  const scriptRecord = scripts as Record<string, unknown>;
  const script = check in scriptRecord ? scriptRecord[check] : undefined;
  if (typeof script !== 'string' || !script.trim()) {
    throw new Error(`package.json 没有 ${check} 脚本。`);
  }

  const selectedScripts: ProjectCheckPlan['scripts'] = [];
  for (const name of [`pre${check}`, check, `post${check}`]) {
    const command = scriptRecord[name];
    if (command === undefined) continue;
    if (typeof command !== 'string' || !command.trim()) {
      throw new Error(`package.json 的 ${name} 脚本无效。`);
    }
    selectedScripts.push({ name, command: command.trim() });
  }

  const pnpmLock = path.join(realRoot, 'pnpm-lock.yaml');
  const npmLock = path.join(realRoot, 'package-lock.json');
  const yarnLock = path.join(realRoot, 'yarn.lock');
  let manager: ProjectCheckPlan['manager'];
  if (await fileExists(pnpmLock)) manager = 'pnpm';
  else if (await fileExists(npmLock)) manager = 'npm';
  else if (await fileExists(yarnLock)) manager = 'yarn';
  else throw new Error('未找到受支持的包管理器锁文件。');

  return {
    check,
    manager,
    scripts: selectedScripts,
    fingerprint: createHash('sha256')
      .update(JSON.stringify({ check, manager, scripts: selectedScripts }), 'utf8')
      .digest('hex'),
  };
};

export const createProjectCheckRunner = (
  execute: ExecFileImplementation = defaultExecFile,
): ProjectCheckRunner => ({
  inspect: inspectProjectCheck,
  run: async (root, plan, signal) => {
    const approvedPlan = await inspectProjectCheck(root, plan.check);
    if (approvedPlan.fingerprint !== plan.fingerprint) {
      throw new Error('package.json 的项目检查脚本已变化，请重新确认。');
    }
    const realRoot = await realpath(root);

    const executable =
      process.platform === 'win32'
        ? (process.env.ComSpec ??
          path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'))
        : plan.manager;
    const args =
      process.platform === 'win32'
        ? ['/d', '/s', '/c', `${plan.manager}.cmd`, 'run', plan.check]
        : ['run', plan.check];
    const result = await execute(executable, args, {
      cwd: realRoot,
      env: safeChildEnvironment(),
      signal,
      timeout: 120_000,
      maxBuffer: 1_000_000,
      windowsHide: true,
    });
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
    const summary =
      result.exitCode === 0 ? `${plan.check} 检查通过。` : `${plan.check} 检查未通过。`;
    return `${summary}${output ? `\n${output.slice(0, MAX_CHECK_OUTPUT_CHARACTERS)}` : ''}`;
  },
});
