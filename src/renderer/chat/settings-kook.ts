import type {
  KookPresenceApi,
  KookPresenceSnapshot,
  KookSettingsInput,
} from '../../shared/social-ipc';
import { createButton, createField, el } from './elements';
import { createPanelLifetime } from './panel-lifetime';
import { presenceStateLabels } from './presence-labels';

/** Explicit refresh only: a hidden settings page never polls or retains enrollment inputs. */
export const mountKookSettings = ({ api }: { api: KookPresenceApi | undefined }) => {
  const lifetime = createPanelLifetime();
  let active = false;
  let generation = 0;
  let busy = false;
  let dirty = false;
  let snapshot: KookPresenceSnapshot | undefined;

  const section = el('section', { className: 'settings-section' });
  const enabledInput = el('input', { type: 'checkbox', checked: false });
  const tokenInput = el('input', {
    type: 'password',
    maxLength: 4_096,
    autocomplete: 'off',
    placeholder: '留空保留已保存的 Bot Token',
  });
  const ownerInput = el('input', {
    maxLength: 128,
    autocomplete: 'off',
    placeholder: '可选；KOOK 用户 ID',
  });
  const clearOwnersInput = el('input', { type: 'checkbox', checked: false });
  const configurationStatus = el('p', { className: 'settings-status' });
  const connectionStatus = el('p', {
    className: 'settings-status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const status = el('p', {
    className: 'settings-status',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const saveButton = createButton('保存 KOOK 设置', 'primary-button');
  const connectButton = createButton('连接 KOOK', 'secondary-button');
  const disconnectButton = createButton('断开 KOOK', 'secondary-button');
  const deleteSecretButton = createButton('删除 Bot Token', 'text-button');
  const refreshButton = createButton('刷新状态', 'text-button');
  const actions = el('div', { className: 'settings-actions' });
  const voiceChannelInput = el('input', { maxLength: 32, placeholder: 'KOOK 语音频道 ID' });
  const voiceTextInput = el('input', {
    maxLength: 1000,
    placeholder: '角色将在房间内公开朗读这段文字',
  });
  const voiceJoinButton = createButton('加入语音频道', 'secondary-button');
  const voiceSpeakButton = createButton('公开朗读', 'secondary-button');
  const voiceLeaveButton = createButton('停止并离房', 'secondary-button');
  const voiceStatus = el('p', { className: 'settings-status', attrs: { role: 'status' } });
  let voiceBusy = false;
  let voiceRequest = 0;
  actions.append(saveButton, connectButton, disconnectButton, deleteSecretButton, refreshButton);
  section.append(
    el('h2', { textContent: 'KOOK' }),
    el('p', {
      className: 'settings-hint',
      textContent:
        'KOOK 官方机器人 · 服务器频道 / 私聊。默认关闭；保存后点击连接。启动时不会自动连接，已保存启用也需手动连接。',
    }),
    createField('启用 KOOK 社交存在（默认关闭）', enabledInput),
    createField('KOOK Bot Token', tokenInput),
    createField('主人 KOOK 用户 ID（可选）', ownerInput),
    createField('保存时清除全部主人绑定', clearOwnersInput),
    el('p', {
      className: 'settings-hint',
      textContent:
        '主人绑定仅允许对应用户在一对一私聊中使用当前角色的桌面私人记忆；服务器频道永不使用主人的私人历史。填写用户 ID 会替换已有绑定；留空保留，勾选清除后保存可移除全部绑定。',
    }),
    el('p', {
      className: 'settings-hint',
      textContent:
        '文字频道内只有被 @ 或被引用回复时角色才会回复。语音房需显式加入，房间内所有人都能听到公开朗读；不会自动转播私聊或采集麦克风。朗读需要已配置的 WAV 语音服务。状态需手动刷新。',
    }),
    configurationStatus,
    connectionStatus,
    actions,
    status,
    createField('语音频道 ID（不会自动加入）', voiceChannelInput),
    voiceJoinButton,
    createField('公开朗读文字（最多 1000 字）', voiceTextInput),
    voiceSpeakButton,
    voiceLeaveButton,
    voiceStatus,
  );

  const updateControls = (): void => {
    const unavailable = !api || !active || busy || !snapshot;
    for (const input of [enabledInput, tokenInput, clearOwnersInput]) {
      input.disabled = unavailable;
    }
    ownerInput.disabled = unavailable || clearOwnersInput.checked;
    saveButton.disabled = unavailable;
    connectButton.disabled =
      unavailable ||
      dirty ||
      !snapshot?.configuration.enabled ||
      !snapshot.configuration.hasToken ||
      snapshot.state === 'online' ||
      snapshot.state === 'connecting';
    disconnectButton.disabled = unavailable;
    deleteSecretButton.disabled = unavailable || !snapshot?.configuration.hasToken;
    refreshButton.disabled = !api || !active || busy;
    const voiceUnavailable = !api?.controlKookVoice || !active || snapshot?.state !== 'online';
    voiceJoinButton.disabled = voiceUnavailable || voiceBusy || busy || dirty;
    voiceSpeakButton.disabled = voiceUnavailable || voiceBusy || busy;
    voiceLeaveButton.disabled = voiceUnavailable;
    voiceChannelInput.disabled = voiceUnavailable || voiceBusy;
    voiceTextInput.disabled = voiceUnavailable || voiceBusy;
  };

  const clearDraft = (): void => {
    voiceTextInput.value = '';
    voiceChannelInput.value = '';
    voiceStatus.textContent = '';
    tokenInput.value = '';
    ownerInput.value = '';
    clearOwnersInput.checked = false;
    enabledInput.checked = false;
    dirty = false;
  };

  const displaySnapshot = (next: KookPresenceSnapshot, saved = false): boolean => {
    const changed = snapshot?.configuration.characterId !== next.configuration.characterId;
    snapshot = next;
    if (changed || saved || !dirty) {
      clearDraft();
      enabledInput.checked = next.configuration.enabled;
    }
    configurationStatus.textContent = `角色：${next.configuration.characterId}；Bot Token：${next.configuration.hasToken ? '已保存（不回显）' : '未保存'}；主人绑定：${next.configuration.ownerBindingCount} 个。`;
    // Errors crossing IPC are never echoed: they may contain credential/provider diagnostics.
    connectionStatus.textContent = `KOOK 状态：${presenceStateLabels[next.state]}${next.errorMessage ? '。操作未完成，请检查应用配置或稍后重试。' : '。'}`;
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
    status.textContent = '正在读取当前角色的 KOOK 配置…';
    try {
      const next = await api.getKookPresence();
      if (!isCurrent(request)) return;
      const changed = displaySnapshot(next);
      status.textContent = changed
        ? '已读取当前角色配置。'
        : dirty
          ? '状态已刷新；未保存的修改已保留，请先保存再连接。'
          : '状态已刷新。';
    } catch {
      if (isCurrent(request)) status.textContent = '无法读取 KOOK 配置，请刷新重试。聊天仍可继续。';
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
      status.textContent = '配置有未保存的修改，请先点击“保存 KOOK 设置”。';
      return;
    }
    if (
      action === 'connect' &&
      (!snapshot.configuration.enabled || !snapshot.configuration.hasToken)
    ) {
      status.textContent = '请填写 Bot Token，勾选启用并保存后再连接。';
      return;
    }
    if (
      action === 'save' &&
      enabledInput.checked &&
      !tokenInput.value &&
      !snapshot.configuration.hasToken
    ) {
      status.textContent = '启用前请填写 KOOK Bot Token。';
      return;
    }
    const characterId = snapshot.configuration.characterId;
    const request = ++generation;
    busy = true;
    updateControls();
    status.textContent = '正在核对当前角色…';
    try {
      // Recheck active identity immediately before every write, including connect and deletion.
      const current = await api.getKookPresence();
      if (!isCurrent(request)) return;
      if (current.configuration.characterId !== characterId) {
        displaySnapshot(current);
        status.textContent = '当前角色已切换，已丢弃旧草稿；请检查新角色配置后再操作。';
        return;
      }
      if (
        action === 'connect' &&
        (current.configuration.enabled !== snapshot.configuration.enabled ||
          current.configuration.hasToken !== snapshot.configuration.hasToken ||
          current.configuration.ownerBindingCount !== snapshot.configuration.ownerBindingCount)
      ) {
        displaySnapshot(current);
        status.textContent = '已保存配置发生变化，请检查后重新连接。';
        return;
      }
      let result: KookPresenceSnapshot;
      if (action === 'save') {
        const input: KookSettingsInput = {
          characterId,
          enabled: enabledInput.checked,
          ...(tokenInput.value ? { botToken: tokenInput.value } : {}),
          ...(clearOwnersInput.checked
            ? { ownerUserIds: [] }
            : ownerInput.value.trim()
              ? { ownerUserIds: [ownerInput.value.trim()] }
              : {}),
        };
        tokenInput.value = '';
        status.textContent = '正在保存 KOOK 设置…';
        result = await api.saveKookPresence(input);
      } else if (action === 'connect') {
        status.textContent = '正在连接 KOOK…';
        result = await api.connectKookPresence({ characterId });
      } else if (action === 'disconnect') {
        status.textContent = '正在断开 KOOK…';
        result = await api.disconnectKookPresence({ characterId });
      } else {
        tokenInput.value = '';
        status.textContent = '正在删除 Bot Token…';
        result = await api.deleteKookSecret({ characterId });
      }
      if (!isCurrent(request)) return;
      displaySnapshot(result, action === 'save');
      status.textContent = result.errorMessage
        ? 'KOOK 操作未完成，请检查配置后重试。'
        : action === 'save'
          ? 'KOOK 设置已保存。启用后可点击连接。'
          : action === 'delete'
            ? '已删除保存的 Bot Token。'
            : action === 'disconnect'
              ? '已请求断开 KOOK。'
              : '连接请求已完成，请查看 KOOK 状态。';
    } catch {
      if (isCurrent(request)) {
        tokenInput.value = '';
        status.textContent = 'KOOK 操作失败，请刷新重试；如需保存 Token，请重新输入。';
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
    status.textContent = '有未保存的修改，请先点击“保存 KOOK 设置”再连接。';
    updateControls();
  };
  for (const input of [tokenInput, ownerInput]) lifetime.on(input, 'input', markDirty);
  lifetime.on(enabledInput, 'change', markDirty);
  lifetime.on(clearOwnersInput, 'change', markDirty);
  lifetime.on(saveButton, 'click', () => void runAction('save'));
  lifetime.on(connectButton, 'click', () => void runAction('connect'));
  lifetime.on(disconnectButton, 'click', () => void runAction('disconnect'));
  lifetime.on(deleteSecretButton, 'click', () => void runAction('delete'));
  lifetime.on(refreshButton, 'click', () => void refresh());
  const runVoice = async (action: 'join' | 'speak' | 'leave'): Promise<void> => {
    if (!api?.controlKookVoice || !active || !snapshot || (voiceBusy && action !== 'leave')) return;
    const request = generation;
    const voiceOperation = ++voiceRequest;
    const characterId = snapshot.configuration.characterId;
    voiceBusy = true;
    updateControls();
    voiceStatus.textContent = '正在处理语音请求…';
    try {
      await api.controlKookVoice({
        characterId,
        ...(action === 'join'
          ? { action, channelId: voiceChannelInput.value.trim() }
          : action === 'speak'
            ? { action, text: voiceTextInput.value }
            : { action }),
      });
      if (isCurrent(request) && voiceOperation === voiceRequest)
        voiceStatus.textContent =
          action === 'join'
            ? '已加入；可点击公开朗读。'
            : action === 'leave'
              ? '已请求停止并离房。'
              : '音频已发送；实际听感请在 KOOK 确认。';
    } catch {
      if (isCurrent(request) && voiceOperation === voiceRequest)
        voiceStatus.textContent =
          '语音操作未完成，请检查连接、频道 ID 和 WAV 语音服务；文字聊天不受影响。';
    } finally {
      if (voiceOperation === voiceRequest) voiceBusy = false;
      if (isCurrent(request)) updateControls();
    }
  };
  lifetime.on(voiceJoinButton, 'click', () => void runVoice('join'));
  lifetime.on(voiceSpeakButton, 'click', () => void runVoice('speak'));
  lifetime.on(voiceLeaveButton, 'click', () => void runVoice('leave'));

  const resetForCharacterChange = (): void => {
    generation += 1;
    busy = false;
    snapshot = undefined;
    clearDraft();
    configurationStatus.textContent = '';
    connectionStatus.textContent = '';
    status.textContent = api
      ? '打开本页或刷新以读取当前角色配置。'
      : 'KOOK 社交存在不可用，聊天仍可继续。';
    updateControls();
    if (active) void refresh();
  };
  updateControls();
  return {
    section,
    elements: {
      voiceChannelInput,
      voiceTextInput,
      voiceJoinButton,
      voiceSpeakButton,
      voiceLeaveButton,
      voiceStatus,
      enabledInput,
      tokenInput,
      ownerInput,
      clearOwnersInput,
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
      if (value) {
        void refresh();
        return;
      }
      // Leaving the page discards the draft and, above all, the credential input.
      generation += 1;
      busy = false;
      clearDraft();
      status.textContent = api
        ? '打开本页或刷新以读取当前角色配置。'
        : 'KOOK 社交存在不可用，聊天仍可继续。';
      updateControls();
    },
    dispose(): void {
      generation += 1;
      clearDraft();
      lifetime.dispose();
    },
  };
};
