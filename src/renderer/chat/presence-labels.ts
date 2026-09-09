import type { SocialConnectionState } from '../../shared/social-ipc';

/** Shared by every platform panel so one connection state never reads differently in two places. */
export const presenceStateLabels: Record<SocialConnectionState, string> = {
  'not-configured': '尚未配置',
  offline: '已断开',
  connecting: '连接中',
  online: '已连接',
  error: '连接失败，请检查配置后重试',
};
