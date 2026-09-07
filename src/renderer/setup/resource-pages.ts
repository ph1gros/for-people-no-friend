import {
  setupResourceIds,
  SETUP_VOICE_ASSETS,
  type SetupResourceStatus,
} from '../../shared/setup-resources';
import type { SetupVoice } from '../../core/setup/setup-flow';
import type { SetupPage, SetupPageContext } from './pages';

interface SetupVoiceChoice {
  value: SetupVoice;
  label: string;
  /** What the user will actually hear. Said before anything is downloaded, not after. */
  language: string;
  /**
   * True when the voice cannot speak a Chinese reply on its own: the chat model has to translate
   * it first. Picking one of these without configuring a provider leaves a voice that stays
   * silent on exactly the replies this app produces.
   */
  needsChatModel: boolean;
  /** The language the chat model has to produce. Stated as data so editing copy cannot change it. */
  translatedTo?: '日语' | '英语';
}

/** Presented in this order; `none` first so the wizard never pushes a download. */
const VOICE_CHOICES: readonly SetupVoiceChoice[] = Object.freeze([
  { value: 'none', label: '暂不配置', language: '', needsChatModel: false },
  {
    value: 'genie-feibi',
    label: 'Genie · 菲比（Feibi）',
    language: '中文朗读。回复是中文时直接读出，不经过聊天模型。',
    needsChatModel: false,
  },
  {
    value: 'genie',
    label: 'Genie · 圣园未花（Mika）',
    language: '日语朗读。中文回复先由当前聊天模型转成日语，再读出来。',
    needsChatModel: true,
    translatedTo: '日语',
  },
  {
    value: 'genie-thirtyseven',
    label: 'Genie · 37（ThirtySeven）',
    language: '英语朗读。中文回复先由当前聊天模型转成英语，再读出来。',
    needsChatModel: true,
    translatedTo: '英语',
  },
  {
    value: 'ireina',
    label: '伊蕾娜（Style-Bert-VITS2）',
    language: '日语朗读。中文回复先由当前聊天模型转成日语，再读出来。',
    needsChatModel: true,
    translatedTo: '日语',
  },
]);

const voiceChoiceOf = (voice: SetupVoice): SetupVoiceChoice | undefined =>
  VOICE_CHOICES.find((choice) => choice.value === voice);

export const formatSetupBytes = (bytes: number): string =>
  `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
const paragraph = (text: string): HTMLParagraphElement => {
  const el = document.createElement('p');
  el.textContent = text;
  return el;
};
const labelOf = (voice: SetupVoice): string => voiceChoiceOf(voice)?.label ?? '暂不配置';
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
    // Only the voice page needs the provider; asking for it on the speech-input page would be a
    // second round trip for a warning that page never shows.
    const provider =
      kind === 'voice'
        ? await context.api.getSetupProviderStatus().catch(() => undefined)
        : undefined;
    const choices = kind === 'voice' ? VOICE_CHOICES.map((c) => c.value) : ['off', 'on'];
    const updateDetail = (): void => {
      const s = context.getSelections();
      const ids = setupResourceIds(
        kind === 'voice' ? { ...s, speechInput: false } : { ...s, voice: 'none' },
      );
      const selected = status.resources.filter((r) => ids.includes(r.id));
      const choice = kind === 'voice' ? voiceChoiceOf(s.voice) : undefined;
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
      if (choice?.language) detail.append(paragraph(choice.language));
      // A voice that needs translation and a wizard run with no provider configured produce a
      // silent character, and the user would only find out after several hundred megabytes.
      if (choice?.needsChatModel && provider && !provider.configuredProviders.length) {
        const warning = paragraph(
          `${choice.label}需要聊天模型把中文回复转成${choice.translatedTo ?? '其他语言'}。` +
            '当前还没有配置聊天服务商，这样安装完成后中文回复不会被朗读。' +
            '可以先返回上一步配置服务商，或改选菲比（中文直读）。',
        );
        warning.className = 'wizard__warning';
        warning.setAttribute('role', 'status');
        detail.append(warning);
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
      if (kind === 'voice') {
        const language = voiceChoiceOf(value as SetupVoice)?.language;
        if (language) text.append(document.createElement('br'), document.createTextNode(language));
      }
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

/**
 * Plays one fixed sentence in the voice that was just installed.
 *
 * Deliberately lives on the resources page rather than the choice page: on a first run nothing is
 * installed yet when the voice is chosen, so a button there would be permanently disabled for
 * exactly the people the wizard exists for. Here it appears the moment the download verifies.
 */
const createVoicePreview = (
  context: SetupPageContext,
): { element: HTMLElement; setReady(ready: boolean): void; stop(): void } => {
  const wrapper = document.createElement('div');
  wrapper.className = 'wizard__inline-actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'wizard__button';
  button.textContent = '试听';
  button.disabled = true;
  const feedback = paragraph('');
  feedback.setAttribute('role', 'status');
  wrapper.append(button, feedback);

  let audio: HTMLAudioElement | undefined;
  let url: string | undefined;
  let playing = false;
  let requestId = 0;
  const release = (): void => {
    requestId += 1;
    audio?.pause();
    audio = undefined;
    if (url) URL.revokeObjectURL(url);
    url = undefined;
    playing = false;
    button.textContent = '试听';
  };
  const stop = (): void => {
    release();
    // Tell main to drop any synthesis still in flight; leaving the page must not leave a process
    // rendering audio nobody will hear.
    void context.api.stopSetupVoicePreview().catch(() => undefined);
  };

  button.addEventListener('click', () => {
    if (playing) {
      stop();
      feedback.textContent = '';
      return;
    }
    playing = true;
    const activeRequest = ++requestId;
    button.textContent = '停止';
    feedback.textContent = '正在合成…';
    void (async () => {
      try {
        const result = await context.api.previewSetupVoice({
          voice: context.getSelections().voice,
        });
        if (activeRequest !== requestId) return;
        if (!result.ok || !result.audio) {
          release();
          // A failed preview is never fatal: the user can still finish setup.
          feedback.textContent =
            result.reason === 'cancelled' ? '' : (result.message ?? '试听失败，可重试。');
          return;
        }
        url = URL.createObjectURL(
          new Blob([new Uint8Array(result.audio)], { type: result.mimeType ?? 'audio/wav' }),
        );
        audio = new Audio(url);
        audio.addEventListener('ended', () => {
          if (activeRequest === requestId) release();
        });
        audio.addEventListener('error', () => {
          if (activeRequest !== requestId) return;
          release();
          feedback.textContent = '音频无法播放，可重试。';
        });
        feedback.textContent = result.text ?? '';
        await audio.play();
      } catch {
        if (activeRequest !== requestId) return;
        release();
        feedback.textContent = '试听失败，可重试。';
      }
    })();
  });

  return {
    element: wrapper,
    setReady: (ready) => {
      button.disabled = !ready;
      if (!ready && playing) stop();
    },
    stop,
  };
};

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
      const preview = createVoicePreview(context);
      const previousStop = stop;
      stop = () => {
        previousStop();
        preview.stop();
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
        // Only offer a preview once the chosen voice itself verified, not merely its dependencies.
        const voiceAsset = SETUP_VOICE_ASSETS[context.getSelections().voice];
        preview.setReady(
          Boolean(
            voiceAsset &&
            status.downloads.tiers.find((t) => t.id === voiceAsset)?.state === 'ready',
          ),
        );
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
      host.replaceChildren(feedback, rows, cost, actions, preview.element);
      await poll();
    },
  };
};
