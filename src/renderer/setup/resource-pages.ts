import { setupResourceIds, type SetupResourceStatus } from '../../shared/setup-resources';
import type { SetupVoice } from '../../core/setup/setup-flow';
import type { SetupPage } from './pages';

export const formatSetupBytes = (bytes: number): string =>
  `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
const paragraph = (text: string): HTMLParagraphElement => {
  const el = document.createElement('p');
  el.textContent = text;
  return el;
};
const labelOf = (voice: SetupVoice): string =>
  voice === 'genie'
    ? 'Genie 日语语音（圣园未花）'
    : voice === 'ireina'
      ? '伊蕾娜日语语音'
      : '暂不配置';
export { labelOf as setupVoiceLabel };

export const createSpeechChoicePage = (kind: 'voice' | 'speechInput'): SetupPage => ({
  render: async (host, _view, context) => {
    const group = document.createElement('fieldset');
    group.className = 'wizard__group';
    const legend = document.createElement('legend');
    legend.textContent = kind === 'voice' ? '选择本地朗读方式' : '是否配置本地麦克风识别';
    group.append(legend);
    const detail = document.createElement('div');
    detail.setAttribute('aria-live', 'polite');
    const status = await context.api.getSetupResources();
    const choices = kind === 'voice' ? ['none', 'genie', 'ireina'] : ['off', 'on'];
    const updateDetail = (): void => {
      const s = context.getSelections();
      const ids = setupResourceIds(
        kind === 'voice' ? { ...s, speechInput: false } : { ...s, voice: 'none' },
      );
      const selected = status.resources.filter((r) => ids.includes(r.id));
      detail.replaceChildren(
        paragraph(
          ids.length
            ? `下载 ${formatSetupBytes(selected.reduce((n, r) => n + (status.downloads.tiers.find((t) => t.id === r.id)?.state === 'ready' ? 0 : r.downloadBytes), 0))}；解压后 ${formatSetupBytes(selected.reduce((n, r) => n + r.installedBytes, 0))}（不含下载临时空间）。`
            : '保持已有设置，稍后可在设置与资源中心配置。',
        ),
      );
      if (ids.length) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = '组件、语言与使用说明';
        details.append(summary);
        for (const r of selected)
          details.append(
            paragraph(
              `${r.name} · ${r.language} · ${r.license}${r.available ? '' : ' · 当前不可下载，可稍后重试'}`,
            ),
          );
        detail.append(details);
      }
    };
    for (const value of choices) {
      const label = document.createElement('label');
      label.className = 'wizard__choice';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = kind;
      input.value = value;
      input.checked =
        kind === 'voice'
          ? context.getSelections().voice === value
          : context.getSelections().speechInput === (value === 'on');
      input.addEventListener('change', () => {
        if (input.checked)
          context.updateSelections(
            kind === 'voice' ? { voice: value as SetupVoice } : { speechInput: value === 'on' },
          );
        updateDetail();
      });
      const text = document.createElement('span');
      text.textContent =
        kind === 'voice'
          ? labelOf(value as SetupVoice)
          : value === 'on'
            ? '启用本地识别（SenseVoice，手动录音）'
            : '暂不配置';
      label.append(input, text);
      group.append(label);
    }
    updateDetail();
    host.replaceChildren(
      group,
      detail,
      paragraph(
        kind === 'voice'
          ? '只会在确认页之后下载。语音是可选功能，不影响文字聊天。'
          : '本页不访问麦克风。完成后使用手动录音；首次录音时再请求权限，拒绝也能使用文字聊天。',
      ),
    );
  },
});

export const createResourceProgressPage = (): SetupPage => {
  let stop = (): void => {};
  return {
    dispose: () => stop(),
    render: async (host, _view, context) => {
      stop();
      let active = true;
      let polling = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      stop = () => {
        active = false;
        if (timer) clearTimeout(timer);
      };
      const rows = document.createElement('div');
      const feedback = paragraph('准备读取安装状态…');
      feedback.setAttribute('role', 'status');
      const cost = document.createElement('label');
      cost.className = 'wizard__checkbox';
      const consent = document.createElement('input');
      consent.type = 'checkbox';
      cost.append(consent, document.createTextNode('允许在计费或费用未知的网络上下载这些组件'));
      const actions = document.createElement('div');
      actions.className = 'wizard__inline-actions';
      const ids = setupResourceIds(context.getSelections());
      const renderStatus = (status: SetupResourceStatus): void => {
        const ready = ids.every(
          (id) => status.downloads.tiers.find((t) => t.id === id)?.state === 'ready',
        );
        context.setNextEnabled(ready);
        const names = {
          pending: '待安装',
          downloading: '下载 / 校验中',
          paused: '已暂停',
          ready: '已验证',
          error: '失败',
        };
        rows.replaceChildren(
          ...ids.map((id) => {
            const resource = status.resources.find((r) => r.id === id);
            const tier = status.downloads.tiers.find((t) => t.id === id);
            const line = document.createElement('div');
            const text = `${resource?.name ?? id}：${tier ? names[tier.state] : '暂不可下载'}`;
            line.append(paragraph(text));
            if (tier) {
              const progress = document.createElement('progress');
              progress.max = Math.max(1, tier.totalBytes);
              progress.value = tier.downloadedBytes;
              progress.setAttribute('aria-label', text);
              line.append(
                progress,
                paragraph(
                  `${formatSetupBytes(tier.downloadedBytes)} / ${formatSetupBytes(tier.totalBytes)}${tier.message ? ` · ${tier.message}` : ''}`,
                ),
              );
            }
            return line;
          }),
        );
        feedback.textContent = ready
          ? '全部组件已通过校验，可以继续。语音设置将在完成时启用。'
          : status.downloads.metered || status.downloads.meteredUnknown
            ? '网络按流量计费或费用未知。确认流量使用后点击开始 / 继续，也可以跳过。'
            : '点击开始下载；中断后可继续，失败可重试或跳过。';
      };
      const poll = async (): Promise<void> => {
        if (!active || polling) return;
        polling = true;
        try {
          const status = await context.api.getSetupResources();
          if (active) renderStatus(status);
        } catch {
          if (active) {
            feedback.textContent = '资源状态读取失败，可重试或跳过。';
            context.setNextEnabled(false);
          }
        } finally {
          polling = false;
          if (active) timer = setTimeout(() => void poll(), 1000);
        }
      };
      for (const [action, text] of [
        ['start', '开始 / 重试'],
        ['pause', '暂停'],
        ['resume', '继续'],
        ['skip', '跳过，稍后在资源中心处理'],
      ] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wizard__button';
        button.textContent = text;
        button.addEventListener('click', () => {
          void context.run(async () => {
            const view = await context.api.controlSetupResources({
              action,
              allowMetered: consent.checked,
            });
            if (action === 'skip') await context.showView(view);
            else {
              const status = await context.api.getSetupResources();
              if (active) renderStatus(status);
            }
          });
        });
        actions.append(button);
      }
      context.setNextEnabled(false);
      host.replaceChildren(feedback, rows, cost, actions);
      await poll();
    },
  };
};
