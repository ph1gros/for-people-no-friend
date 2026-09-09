import type {
  OopzBridgeProcessState,
  OopzPresenceApi,
  OopzPresenceSnapshot,
  OopzSettingsInput,
} from '../../shared/social-ipc';
import { createButton, createField, el } from './elements';
import { createPanelLifetime } from './panel-lifetime';
import { presenceStateLabels } from './presence-labels';

/** Process liveness only. Running does NOT mean the bridge logged in or OneBot is ready. */
const bridgeLabels: Record<OopzBridgeProcessState, string> = {
  stopped: '未运行',
  starting: '启动中',
  running: '进程运行中（不代表已登录）',
  stopping: '停止中',
  error: '启动失败',
};

const WARNING_VERSION = 1;

/** Explicit refresh only: a hidden settings page never polls or retains enrollment inputs. */
export const mountOopzSettings = ({ api }: { api: OopzPresenceApi | undefined }) => {
  const lifetime = createPanelLifetime();
  let active = false;
  let generation = 0;
  let busy = false;
  let dirty = false;
  let snapshot: OopzPresenceSnapshot | undefined;

  const section = el('section', { className: 'settings-section' });
  const enabledInput = el('input', { type: 'checkbox', checked: false });
  const warningInput = el('input', { type: 'checkbox', checked: false });
  const urlInput = el('input', {
    maxLength: 2_048,
    autocomplete: 'off',
    placeholder: 'ws://127.0.0.1:6700 （仅限本机）',
  });
  const accountInput = el('input', {
    maxLength: 32,
    autocomplete: 'off',
    placeholder: '专用测试账号手机号',
  });
  const passwordInput = el('input', {
    type: 'password',
    maxLength: 256,
    autocomplete: 'off',
    placeholder: '留空保留已保存的密码',
  });
  const ownerInput = el('input', {
    maxLength: 128,
    autocomplete: 'off',
    placeholder: '可选；Oopz 用户 ID',
  });
  const clearOwnersInput = el('input', { type: 'checkbox', checked: false });
  const configurationStatus = el('p', { className: 'settings-status' });
  const bridgeStatus = el('p', {
    className: 'settings-status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const connectionStatus = el('p', {
    className: 'settings-status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const status = el('p', {
    className: 'settings-status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const saveButton = createButton('保存 Oopz 设置', 'primary-button');
  const startBridgeButton = createButton('启动桥接进程', 'secondary-button');
  const stopBridgeButton = createButton('停止桥接进程', 'secondary-button');
  const connectButton = createButton('连接 OneBot', 'secondary-button');
  const disconnectButton = createButton('断开 OneBot', 'secondary-button');
  const deleteSecretButton = createButton('删除已保存账号密码', 'text-button');
  const refreshButton = createButton('刷新状态', 'text-button');
  const actions = el('div', { className: 'settings-actions' });
  actions.append(
    saveButton,
    startBridgeButton,
    stopBridgeButton,
    connectButton,
    disconnectButton,
    deleteSecretButton,
    refreshButton,
  );
  section.append(
    el('h2', { textContent: 'Oopz（实验性）' }),
    el('p', {
      className: 'settings-hint',
      textContent:
        'Oopz 桥接为非官方社区实验功能，协议变化可能导致登录失败或账号受限。建议使用专用测试账号。桥接进程运行时必须接触明文账号密码，请仅使用经过审核的运行时；本应用不会自动下载、启动或重启桥接。',
    }),
    createField('我已阅读并接受上述实验性风险', warningInput),
    createField('启用 Oopz 社交存在（默认关闭）', enabledInput),
    createField('OneBot 端点（仅限本机）', urlInput),
    createField('Oopz 账号（手机号）', accountInput),
    createField('Oopz 密码', passwordInput),
    createField('主人 Oopz 用户 ID（可选）', ownerInput),
    createField('保存时清除全部主人绑定', clearOwnersInput),
    el('p', {
      className: 'settings-hint',
      textContent:
        '端点只接受本机地址（127.0.0.1 / ::1 / localhost）。桥接进程与 OneBot 连接是两件独立的事：启动进程不会自动连接，连接也不会自动启动进程，请按需分别操作。进程「运行中」只表示子进程已启动，不代表已登录 Oopz 或 OneBot 已就绪。',
    }),
    el('p', {
      className: 'settings-hint',
      textContent:
        '主人绑定仅允许对应用户在一对一私聊中使用当前角色的桌面私人记忆；群聊永不使用主人的私人历史。账号与密码必须一起填写；留空两者则保留已保存的凭据。离开本页会丢弃未保存内容并清空密码输入。',
    }),
    configurationStatus,
    bridgeStatus,
    connectionStatus,
    actions,
    status,
  );

  const runtimeReady = (): boolean => snapshot?.configuration.runtimeAvailable === true;

  const updateControls = (): void => {
    const unavailable = !api || !active || busy || !snapshot;
    for (const input of [
      enabledInput,
      warningInput,
      urlInput,
      accountInput,
      passwordInput,
      clearOwnersInput,
    ]) {
      input.disabled = unavailable;
    }
    ownerInput.disabled = unavailable || clearOwnersInput.checked;
    saveButton.disabled = unavailable;
    // Starting is impossible without an audited runtime; the manager would refuse anyway.
    startBridgeButton.disabled =
      unavailable ||
      dirty ||
      !runtimeReady() ||
      !snapshot?.configuration.enabled ||
      !snapshot.configuration.hasCredentials ||
      snapshot.bridge === 'running' ||
      snapshot.bridge === 'starting';
    stopBridgeButton.disabled = unavailable || snapshot?.bridge === 'stopped';
    connectButton.disabled =
      unavailable ||
      dirty ||
      snapshot?.bridge !== 'running' ||
      !snapshot.configuration.enabled ||
      !snapshot.configuration.onebotUrl ||
      snapshot.state === 'online' ||
      snapshot.state === 'connecting';
    disconnectButton.disabled = unavailable;
    deleteSecretButton.disabled = unavailable || !snapshot?.configuration.hasCredentials;
    refreshButton.disabled = !api || !active || busy;
  };

  const clearDraft = (): void => {
    urlInput.value = '';
    accountInput.value = '';
    passwordInput.value = '';
    ownerInput.value = '';
    clearOwnersInput.checked = false;
    enabledInput.checked = false;
    warningInput.checked = false;
    dirty = false;
  };

  const displaySnapshot = (next: OopzPresenceSnapshot, saved = false): boolean => {
    const changed = snapshot?.configuration.characterId !== next.configuration.characterId;
    snapshot = next;
    if (changed || saved || !dirty) {
      clearDraft();
      enabledInput.checked = next.configuration.enabled;
      urlInput.value = next.configuration.onebotUrl;
    }
    configurationStatus.textContent = `角色：${next.configuration.characterId}；账号密码：${next.configuration.hasCredentials ? '已保存（不回显）' : '未保存'}；主人绑定：${next.configuration.ownerBindingCount} 个。`;
    bridgeStatus.textContent = next.configuration.runtimeAvailable
      ? `桥接进程：${bridgeLabels[next.bridge]}。`
      : `桥接进程：${bridgeLabels[next.bridge]}；未配置经过审核的桥接运行时，无法启动，已保存的密码也不会被解密。`;
    // Errors crossing IPC are never echoed: they may contain credential/provider diagnostics.
    connectionStatus.textContent = `OneBot 连接：${presenceStateLabels[next.state]}${next.errorMessage ? '。操作未完成，请检查应用配置或稍后重试。' : '。'}`;
    updateControls();
    return changed;
  };

  const isCurrent = (request: number): boolean =>
    !lifetime.disposed && active && request === generation;

  const refresh = async (): Promise<void> => {
    if (!api || !active || busy || lifetime.disposed) return;
    const request = ++generation;
    busy = true;
    updateControls();
    status.textContent = '正在读取当前角色的 Oopz 配置…';
    try {
      const next = await api.getOopzPresence();
      if (!isCurrent(request)) return;
      const changed = displaySnapshot(next);
      status.textContent = changed
        ? '已读取当前角色配置。'
        : dirty
          ? '状态已刷新；未保存的修改已保留，请先保存再操作。'
          : '状态已刷新。';
    } catch {
      if (isCurrent(request)) status.textContent = '无法读取 Oopz 配置，请刷新重试。聊天仍可继续。';
    } finally {
      if (isCurrent(request)) {
        busy = false;
        updateControls();
      }
    }
  };

  type Action = 'save' | 'start' | 'stop' | 'connect' | 'disconnect' | 'delete';
  const runAction = async (action: Action): Promise<void> => {
    if (!api || !active || busy || !snapshot || lifetime.disposed) return;
    if ((action === 'start' || action === 'connect') && dirty) {
      status.textContent = '配置有未保存的修改，请先点击“保存 Oopz 设置”。';
      return;
    }
    const wantsCredentials = !!accountInput.value.trim() || !!passwordInput.value;
    if (action === 'save' && wantsCredentials) {
      if (!accountInput.value.trim() || !passwordInput.value) {
        status.textContent = '账号与密码必须一起填写。';
        return;
      }
      if (!warningInput.checked) {
        status.textContent = '保存账号密码前，请先勾选并接受实验性风险说明。';
        return;
      }
    }
    if (action === 'start' && !warningInput.checked) {
      status.textContent = '启动桥接进程前，请先勾选并接受实验性风险说明。';
      return;
    }
    if (action === 'start' && !runtimeReady()) {
      status.textContent = '未配置经过审核的桥接运行时，无法启动；已保存的密码不会被解密。';
      return;
    }
    const characterId = snapshot.configuration.characterId;
    const request = ++generation;
    busy = true;
    updateControls();
    status.textContent = '正在核对当前角色…';
    try {
      // Recheck active identity immediately before every write, including start and deletion.
      const current = await api.getOopzPresence();
      if (!isCurrent(request)) return;
      if (current.configuration.characterId !== characterId) {
        displaySnapshot(current);
        status.textContent = '当前角色已切换，已丢弃旧草稿；请检查新角色配置后再操作。';
        return;
      }
      let result: OopzPresenceSnapshot;
      if (action === 'save') {
        const input: OopzSettingsInput = {
          characterId,
          enabled: enabledInput.checked,
          ...(urlInput.value.trim() ? { onebotUrl: urlInput.value.trim() } : {}),
          ...(wantsCredentials
            ? {
                account: accountInput.value.trim(),
                password: passwordInput.value,
                acceptedWarningVersion: WARNING_VERSION,
              }
            : {}),
          ...(clearOwnersInput.checked
            ? { ownerUserIds: [] }
            : ownerInput.value.trim()
              ? { ownerUserIds: [ownerInput.value.trim()] }
              : {}),
        };
        passwordInput.value = '';
        status.textContent = '正在保存 Oopz 设置…';
        result = await api.saveOopzPresence(input);
      } else if (action === 'start') {
        status.textContent = '正在启动桥接进程…';
        result = await api.startOopzBridge({
          characterId,
          acceptedWarningVersion: WARNING_VERSION,
        });
      } else if (action === 'stop') {
        status.textContent = '正在停止桥接进程…';
        result = await api.stopOopzBridge({ characterId });
      } else if (action === 'connect') {
        status.textContent = '正在连接 OneBot…';
        result = await api.connectOopzPresence({ characterId });
      } else if (action === 'disconnect') {
        status.textContent = '正在断开 OneBot…';
        result = await api.disconnectOopzPresence({ characterId });
      } else {
        passwordInput.value = '';
        status.textContent = '正在删除已保存的账号密码…';
        result = await api.deleteOopzSecret({ characterId });
      }
      if (!isCurrent(request)) return;
      displaySnapshot(result, action === 'save');
      status.textContent = result.errorMessage
        ? 'Oopz 操作未完成，请检查配置后重试。'
        : action === 'save'
          ? 'Oopz 设置已保存。启用并启动桥接后可连接。'
          : action === 'delete'
            ? '已删除保存的账号密码。'
            : action === 'start'
              ? '已请求启动桥接进程；运行中不代表已登录，请确认后再连接。'
              : action === 'stop'
                ? '已请求停止桥接进程。'
                : action === 'disconnect'
                  ? '已请求断开 OneBot。'
                  : '连接请求已完成，请查看 OneBot 状态。';
    } catch {
      if (isCurrent(request)) {
        passwordInput.value = '';
        status.textContent = 'Oopz 操作失败，请刷新重试；如需保存密码，请重新输入。';
      }
    } finally {
      if (isCurrent(request)) {
        busy = false;
        updateControls();
      }
    }
  };

  const markDirty = (): void => {
    if (!active || busy) return;
    dirty = true;
    status.textContent = '有未保存的修改，请先点击“保存 Oopz 设置”再操作。';
    updateControls();
  };
  for (const input of [urlInput, accountInput, passwordInput, ownerInput])
    lifetime.on(input, 'input', markDirty);
  lifetime.on(enabledInput, 'change', markDirty);
  lifetime.on(clearOwnersInput, 'change', markDirty);
  // Accepting the warning is a per-action confirmation, not a stored setting: it never marks dirty.
  lifetime.on(warningInput, 'change', () => updateControls());
  lifetime.on(saveButton, 'click', () => void runAction('save'));
  lifetime.on(startBridgeButton, 'click', () => void runAction('start'));
  lifetime.on(stopBridgeButton, 'click', () => void runAction('stop'));
  lifetime.on(connectButton, 'click', () => void runAction('connect'));
  lifetime.on(disconnectButton, 'click', () => void runAction('disconnect'));
  lifetime.on(deleteSecretButton, 'click', () => void runAction('delete'));
  lifetime.on(refreshButton, 'click', () => void refresh());

  const resetForCharacterChange = (): void => {
    generation += 1;
    busy = false;
    snapshot = undefined;
    clearDraft();
    configurationStatus.textContent = '';
    bridgeStatus.textContent = '';
    connectionStatus.textContent = '';
    status.textContent = api
      ? '打开本页或刷新以读取当前角色配置。'
      : 'Oopz 社交存在不可用，聊天仍可继续。';
    updateControls();
    if (active) void refresh();
  };
  updateControls();
  return {
    section,
    elements: {
      enabledInput,
      warningInput,
      urlInput,
      accountInput,
      passwordInput,
      ownerInput,
      clearOwnersInput,
      configurationStatus,
      bridgeStatus,
      connectionStatus,
      status,
      saveButton,
      startBridgeButton,
      stopBridgeButton,
      connectButton,
      disconnectButton,
      deleteSecretButton,
      refreshButton,
    },
    refresh,
    resetForCharacterChange,
    setActive(value: boolean): void {
      if (lifetime.disposed || active === value) return;
      active = value;
      if (value) {
        void refresh();
        return;
      }
      // Leaving the page discards the draft and, above all, the credential inputs.
      generation += 1;
      busy = false;
      clearDraft();
      status.textContent = api
        ? '打开本页或刷新以读取当前角色配置。'
        : 'Oopz 社交存在不可用，聊天仍可继续。';
      updateControls();
    },
    dispose(): void {
      generation += 1;
      clearDraft();
      lifetime.dispose();
    },
  };
};
