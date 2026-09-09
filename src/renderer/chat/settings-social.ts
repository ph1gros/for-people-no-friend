import type { QqPresenceApi, QqPresenceSnapshot, QqSettingsInput } from '../../shared/social-ipc';
import { createButton, createField, el } from './elements';
import { presenceStateLabels } from './presence-labels';
import { createPanelLifetime } from './panel-lifetime';

/** Explicit refresh only: a hidden settings page never polls or retains enrollment inputs. */
export const mountSocialSettings = ({ api }: { api: QqPresenceApi | undefined }) => {
  const lifetime = createPanelLifetime();
  let active = false;
  let generation = 0;
  let busy = false;
  let dirty = false;
  let snapshot: QqPresenceSnapshot | undefined;

  const section = el('section', { className: 'settings-section' });
  const appIdInput = el('input', { maxLength: 128, autocomplete: 'off' });
  const appSecretInput = el('input', {
    type: 'password',
    maxLength: 4_096,
    autocomplete: 'off',
    placeholder: '留空保留已保存的 App Secret',
  });
  const ownerInput = el('input', {
    maxLength: 128,
    autocomplete: 'off',
    placeholder: '可选；必须是当前机器人的 openid，非 QQ 号',
  });
  const clearOwnersInput = el('input', { type: 'checkbox', checked: false });
  const enabledInput = el('input', { type: 'checkbox', checked: false });
  const voiceInput = el('input', { type: 'checkbox', checked: false });
  const configurationStatus = el('p', { className: 'settings-status' });
  const connectionStatus = el('p', {
    className: 'settings-status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const status = el('p', {
    className: 'settings-status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const saveButton = createButton('保存 QQ 设置', 'primary-button');
  const connectButton = createButton('连接 QQ', 'secondary-button');
  const disconnectButton = createButton('断开 QQ', 'secondary-button');
  const deleteSecretButton = createButton('删除 App Secret', 'text-button');
  const refreshButton = createButton('刷新状态', 'text-button');
  const actions = el('div', { className: 'settings-actions' });
  actions.append(saveButton, connectButton, disconnectButton, deleteSecretButton, refreshButton);
  section.append(
    el('h2', { textContent: '社交存在' }),
    el('p', {
      className: 'settings-hint',
      textContent:
        'QQ 官方机器人 · 群聊 / C2C 私聊。默认关闭；保存后点击连接。PR2 启动时不会自动连接，已保存启用也需手动连接。',
    }),
    createField('启用 QQ 社交存在（默认关闭）', enabledInput),
    createField('用语音回复（默认关闭）', voiceInput),
    el('p', {
      className: 'settings-hint',
      textContent:
        '语音回复会把角色的文字回复合成为 QQ 原生语音消息，需要先在语音设置里启用并选择一个会输出 WAV 的语音服务商。缺少可选的 SILK 编解码器、语音服务商未配置或合成失败时，会自动退回文字回复。该开关在连接时生效，修改后需要重新连接。',
    }),
    createField('QQ App ID', appIdInput),
    createField('QQ App Secret', appSecretInput),
    createField('主人 owner openid（可选）', ownerInput),
    createField('保存时清除全部主人绑定', clearOwnersInput),
    el('p', {
      className: 'settings-hint',
      textContent:
        '必须填写当前机器人对应的用户 openid，不是 QQ 号。主人绑定仅允许对应用户在一对一私聊（C2C）中使用当前角色的桌面私人记忆。公开群聊永不使用主人的私人历史。填写 openid 会替换已有绑定；留空保留，勾选清除后保存可移除全部绑定。更换 App ID 会清除原主人绑定和原密钥；新密钥和新绑定需重新填写。',
    }),
    el('p', {
      className: 'settings-hint',
      textContent:
        '状态需手动刷新。修改后请先保存 QQ 设置再连接；离开本页会丢弃未保存内容并清空密钥输入。',
    }),
    configurationStatus,
    connectionStatus,
    actions,
    status,
  );

  const updateControls = (): void => {
    const unavailable = !api || !active || busy || !snapshot;
    for (const input of [appIdInput, appSecretInput, enabledInput, voiceInput, clearOwnersInput]) {
      input.disabled = unavailable;
    }
    ownerInput.disabled = unavailable || clearOwnersInput.checked;
    saveButton.disabled = unavailable;
    connectButton.disabled =
      unavailable ||
      dirty ||
      !snapshot?.configuration.enabled ||
      !snapshot.configuration.appId ||
      !snapshot.configuration.hasSecret ||
      snapshot.state === 'online' ||
      snapshot.state === 'connecting';
    disconnectButton.disabled = unavailable;
    deleteSecretButton.disabled = unavailable || !snapshot?.configuration.hasSecret;
    refreshButton.disabled = !api || !active || busy;
  };

  const clearDraft = (): void => {
    appIdInput.value = '';
    appSecretInput.value = '';
    ownerInput.value = '';
    clearOwnersInput.checked = false;
    enabledInput.checked = false;
    voiceInput.checked = false;
    dirty = false;
  };

  const displaySnapshot = (next: QqPresenceSnapshot, saved = false): boolean => {
    const changed = snapshot?.configuration.characterId !== next.configuration.characterId;
    snapshot = next;
    if (changed || saved || !dirty) {
      clearDraft();
      appIdInput.value = next.configuration.appId;
      enabledInput.checked = next.configuration.enabled;
      voiceInput.checked = next.configuration.voiceReplyEnabled;
    }
    configurationStatus.textContent = `角色：${next.configuration.characterId}；App Secret：${next.configuration.hasSecret ? '已保存（不回显）' : '未保存'}；主人绑定：${next.configuration.ownerBindingCount} 个。`;
    // Errors crossing IPC are never echoed: they may contain credential/provider diagnostics.
    connectionStatus.textContent = `QQ 状态：${presenceStateLabels[next.state]}${next.errorMessage ? '。操作未完成，请检查应用配置或稍后重试。' : '。'}`;
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
    status.textContent = '正在读取当前角色的 QQ 配置…';
    try {
      const next = await api.getQqPresence();
      if (!isCurrent(request)) return;
      const changed = displaySnapshot(next);
      status.textContent = changed
        ? '已读取当前角色配置。'
        : dirty
          ? '状态已刷新；未保存的修改已保留，请先保存再连接。'
          : '状态已刷新。';
    } catch {
      if (isCurrent(request)) status.textContent = '无法读取 QQ 配置，请刷新重试。聊天仍可继续。';
    } finally {
      if (isCurrent(request)) {
        busy = false;
        updateControls();
      }
    }
  };

  type Action = 'save' | 'connect' | 'disconnect' | 'delete';
  const runAction = async (action: Action): Promise<void> => {
    if (!api || !active || busy || !snapshot || lifetime.disposed) return;
    if (action === 'connect' && dirty) {
      status.textContent = '配置有未保存的修改，请先点击“保存 QQ 设置”。';
      return;
    }
    if (
      action === 'connect' &&
      (!snapshot.configuration.enabled ||
        !snapshot.configuration.appId ||
        !snapshot.configuration.hasSecret)
    ) {
      status.textContent = '请填写 App ID 和 App Secret，勾选启用并保存后再连接。';
      return;
    }
    if (
      action === 'save' &&
      enabledInput.checked &&
      (!appIdInput.value.trim() ||
        (!appSecretInput.value &&
          (!snapshot.configuration.hasSecret ||
            appIdInput.value.trim() !== snapshot.configuration.appId)))
    ) {
      status.textContent = '启用前请填写 App ID 和 App Secret；更换 App ID 需要新的 App Secret。';
      return;
    }
    const characterId = snapshot.configuration.characterId;
    const request = ++generation;
    busy = true;
    updateControls();
    status.textContent = '正在核对当前角色…';
    try {
      // Recheck active identity immediately before every write, including connect and deletion.
      const current = await api.getQqPresence();
      if (!isCurrent(request)) return;
      if (current.configuration.characterId !== characterId) {
        displaySnapshot(current);
        status.textContent = '当前角色已切换，已丢弃旧草稿；请检查新角色配置后再操作。';
        return;
      }
      if (
        action === 'connect' &&
        (current.configuration.appId !== snapshot.configuration.appId ||
          current.configuration.enabled !== snapshot.configuration.enabled ||
          current.configuration.voiceReplyEnabled !== snapshot.configuration.voiceReplyEnabled ||
          current.configuration.hasSecret !== snapshot.configuration.hasSecret ||
          current.configuration.ownerBindingCount !== snapshot.configuration.ownerBindingCount)
      ) {
        displaySnapshot(current);
        status.textContent = '已保存配置发生变化，请检查后重新连接。';
        return;
      }
      let result: QqPresenceSnapshot;
      if (action === 'save') {
        const input: QqSettingsInput = {
          characterId,
          appId: appIdInput.value.trim(),
          enabled: enabledInput.checked,
          voiceReplyEnabled: voiceInput.checked,
          ...(appSecretInput.value ? { appSecret: appSecretInput.value } : {}),
          ...(clearOwnersInput.checked
            ? { ownerUserIds: [] }
            : ownerInput.value.trim()
              ? { ownerUserIds: [ownerInput.value.trim()] }
              : {}),
        };
        appSecretInput.value = '';
        status.textContent = '正在保存 QQ 设置…';
        result = await api.saveQqPresence(input);
      } else if (action === 'connect') {
        status.textContent = '正在连接 QQ…';
        result = await api.connectQqPresence({ characterId });
      } else if (action === 'disconnect') {
        status.textContent = '正在断开 QQ…';
        result = await api.disconnectQqPresence({ characterId });
      } else {
        appSecretInput.value = '';
        status.textContent = '正在删除 App Secret…';
        result = await api.deleteQqSecret({ characterId });
      }
      if (!isCurrent(request)) return;
      displaySnapshot(result, action === 'save');
      status.textContent = result.errorMessage
        ? 'QQ 操作未完成，请检查配置后重试。'
        : action === 'save'
          ? 'QQ 设置已保存。启用后可点击连接。'
          : action === 'delete'
            ? '已删除保存的 App Secret。'
            : action === 'disconnect'
              ? '已请求断开 QQ。'
              : '连接请求已完成，请查看 QQ 状态。';
    } catch {
      if (isCurrent(request)) {
        appSecretInput.value = '';
        status.textContent = 'QQ 操作失败，请刷新重试；如需保存密钥，请重新输入。';
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
    status.textContent = '有未保存的修改，请先点击“保存 QQ 设置”再连接。';
    updateControls();
  };
  for (const input of [appIdInput, appSecretInput, ownerInput])
    lifetime.on(input, 'input', markDirty);
  lifetime.on(enabledInput, 'change', markDirty);
  lifetime.on(voiceInput, 'change', markDirty);
  lifetime.on(clearOwnersInput, 'change', markDirty);
  lifetime.on(saveButton, 'click', () => void runAction('save'));
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
    connectionStatus.textContent = '';
    status.textContent = api
      ? '打开本页或刷新以读取当前角色配置。'
      : 'QQ 社交存在不可用，聊天仍可继续。';
    updateControls();
    if (active) void refresh();
  };
  updateControls();
  return {
    section,
    elements: {
      appIdInput,
      appSecretInput,
      ownerInput,
      clearOwnersInput,
      enabledInput,
      voiceInput,
      configurationStatus,
      connectionStatus,
      status,
      saveButton,
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
      resetForCharacterChange();
    },
    dispose(): void {
      active = false;
      generation += 1;
      clearDraft();
      lifetime.dispose();
      updateControls();
    },
  };
};
