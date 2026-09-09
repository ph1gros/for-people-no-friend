import { parseCharacterIdInput } from './character-package-ipc';

export const OOPZ_BRIDGE_WARNING_VERSION = 1;
export const OOPZ_BRIDGE_WARNING =
  'Oopz 桥接为非官方社区实验功能，协议变化可能导致登录失败或账号受限。建议使用专用测试账号。桥接进程运行时必须接触明文账号密码，请仅使用经过审核的运行时；不会自动下载、启动或重启桥接。';
export const OOPZ_BRIDGE_ERROR = 'Oopz 桥接不可用；请检查实验功能配置。文字聊天不受影响。';

export interface OopzBridgeCredentials {
  account: string;
  password: string;
}
export interface OopzBridgeStartInput {
  characterId: string;
  acceptedWarningVersion: 1;
}
export interface OopzBridgeSaveInput extends OopzBridgeStartInput, OopzBridgeCredentials {}
export type OopzBridgeState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
export interface OopzBridgeSnapshot {
  characterId: string;
  state: OopzBridgeState;
  hasCredentials: boolean;
  experimental: true;
  warning: string;
  errorMessage?: string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(OOPZ_BRIDGE_ERROR);
  return value as Record<string, unknown>;
}
export function parseOopzBridgeStart(value: unknown): OopzBridgeStartInput {
  const input = record(value);
  const { characterId } = parseCharacterIdInput(input);
  if (input.acceptedWarningVersion !== OOPZ_BRIDGE_WARNING_VERSION)
    throw new Error(OOPZ_BRIDGE_ERROR);
  return { characterId, acceptedWarningVersion: 1 };
}
export function parseOopzBridgeCredentials(value: unknown): OopzBridgeCredentials {
  const input = record(value);
  if (
    typeof input.account !== 'string' ||
    !/^\+?[0-9]{5,20}$/u.test(input.account) ||
    typeof input.password !== 'string' ||
    input.password.length < 1 ||
    input.password.length > 256 ||
    !input.password.trim() ||
    /^[*\u2022]+$/u.test(input.password) ||
    /\p{Cc}/u.test(input.password)
  )
    throw new Error(OOPZ_BRIDGE_ERROR);
  // Password whitespace is significant; never trim passwords.
  return { account: input.account, password: input.password };
}
export function parseOopzBridgeSave(value: unknown): OopzBridgeSaveInput {
  return { ...parseOopzBridgeStart(value), ...parseOopzBridgeCredentials(value) };
}
