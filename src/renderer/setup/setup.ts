import type { SetupSelections, SetupStepId, SetupViewState } from '../../shared/setup-ipc';
import { DEFAULT_SETUP_SELECTIONS } from '../../shared/setup-ipc';
import { createSpeechChoicePage, createResourceProgressPage } from './resource-pages';

import {
  createCharacterPage,
  createFinishPage,
  createModePage,
  createProviderPage,
  createReviewPage,
  createWelcomePage,
  type SetupPage,
  type SetupPageContext,
} from './pages';

const STEP_LABELS: Record<SetupStepId, string> = {
  welcome: '欢迎',
  mode: '设置方式',
  provider: '模型服务商',
  character: '角色来源',
  voice: '语音输出',
  speechInput: '语音输入',
  resources: '安装组件',
  review: '确认',
  finish: '完成',
};

const PAGE_HEADINGS: Record<SetupStepId, { title: string; description: string }> = {
  voice: { title: '本地语音输出', description: '可选日语朗读；不启用也能使用文字聊天。' },
  speechInput: {
    title: '本地语音识别',
    description: '选择手动录音输入，麦克风权限在实际录音时申请。',
  },
  resources: {
    title: '安装所选组件',
    description: '复用资源中心的下载与校验。可以暂停、继续或跳过。',
  },
  welcome: {
    title: '欢迎使用 For People No Friend',
    description: '本向导会准备模型连接、角色来源与可选的本地语音组件。',
  },
  mode: {
    title: '基础设置方式',
    description: '推荐设置适合大多数用户；自定义设置会显示更多可选步骤。',
  },
  provider: {
    title: '模型服务商与 API Key',
    description: '决定首次启动后能否直接开始文字对话。可以现在填写，也可以稍后配置。',
  },
  character: {
    title: '角色来源',
    description: '选择首次启动使用的角色。占位角色随时可以替换。',
  },
  review: {
    title: '确认设置内容',
    description: '在写入配置前请确认以下内容。',
  },
  finish: {
    title: '设置完成',
    description: 'For People No Friend 已经可以启动。',
  },
};

const root = document.querySelector<HTMLElement>('#setup');
if (!root) {
  throw new Error('Setup root element is missing.');
}

const api = window.deskpetSetup;

const heading = document.createElement('h1');
heading.className = 'wizard__title';
heading.tabIndex = -1;

const description = document.createElement('p');
description.className = 'wizard__description';

const stepList = document.createElement('ol');
stepList.className = 'wizard__steps';
stepList.setAttribute('aria-label', '设置步骤');

const page = document.createElement('section');
page.className = 'wizard__page';

const status = document.createElement('p');
status.className = 'wizard__status';
status.setAttribute('role', 'status');
status.hidden = true;

const progress = document.createElement('span');
progress.className = 'wizard__progress';

const createButton = (label: string, modifier = ''): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = modifier ? `wizard__button ${modifier}` : 'wizard__button';
  button.textContent = label;
  return button;
};

const backButton = createButton('上一步');
const nextButton = createButton('下一步', 'wizard__button--primary');
const cancelButton = createButton('取消');

const header = document.createElement('header');
header.className = 'wizard__header';
header.append(heading, description);

const body = document.createElement('div');
body.className = 'wizard__body';
body.append(stepList, page);

const actions = document.createElement('div');
actions.className = 'wizard__actions';
actions.append(backButton, nextButton, cancelButton);

const footer = document.createElement('footer');
footer.className = 'wizard__footer';
footer.append(progress, actions);

root.replaceChildren(header, body, status, footer);

let selections: SetupSelections = { ...DEFAULT_SETUP_SELECTIONS };
let isFinalStep = false;
let currentPage: SetupPage | undefined;
let busy = false;
let nextEnabled = true;
let canGoBack = false;

const setStatus = (message?: string, tone: 'info' | 'error' = 'info'): void => {
  status.textContent = message ?? '';
  status.hidden = !message;
  status.classList.toggle('wizard__status--error', Boolean(message) && tone === 'error');
};

const pageContext: SetupPageContext = {
  get api() {
    if (!api) throw new Error('The setup bridge is unavailable.');
    return api;
  },
  getSelections: () => ({ ...selections }),
  updateSelections: (patch) => {
    selections = { ...selections, ...patch };
  },
  setStatus,
  setNextEnabled: (enabled) => {
    nextEnabled = enabled;
    nextButton.disabled = busy || !enabled;
  },
  showView: (view) => render(view),
  run: (operation) => runExclusive(operation),
};

const PAGES: Record<SetupStepId, SetupPage> = {
  welcome: createWelcomePage(),
  mode: createModePage(),
  provider: createProviderPage(),
  character: createCharacterPage(),
  voice: createSpeechChoicePage('voice'),
  speechInput: createSpeechChoicePage('speechInput'),
  resources: createResourceProgressPage(),
  review: createReviewPage(),
  finish: createFinishPage(),
};

const renderSteps = (view: SetupViewState): void => {
  stepList.replaceChildren(
    ...view.visibleSteps.map((stepId, index) => {
      const item = document.createElement('li');
      item.className = 'wizard__step';
      if (index < view.stepIndex) item.classList.add('is-done');
      if (stepId === view.stepId) {
        item.classList.add('is-current');
        item.setAttribute('aria-current', 'step');
      }
      item.textContent = STEP_LABELS[stepId];
      return item;
    }),
  );
};

const render = async (view: SetupViewState): Promise<void> => {
  currentPage?.dispose?.();
  nextEnabled = true;
  selections = { ...view.selections };
  isFinalStep = view.isFinalStep;
  const headings = PAGE_HEADINGS[view.stepId];
  heading.textContent = headings.title;
  description.textContent = headings.description;
  renderSteps(view);
  progress.textContent = `第 ${view.stepIndex + 1} 步，共 ${view.visibleSteps.length} 步`;
  canGoBack = view.canGoBack;
  backButton.disabled = !canGoBack;
  nextButton.textContent = view.isFinalStep
    ? '完成'
    : view.stepId === 'review'
      ? '确认并继续'
      : '下一步';
  cancelButton.hidden = view.isFinalStep;
  currentPage = PAGES[view.stepId];
  await currentPage.render(page, view, pageContext);
  heading.focus();
};

const runExclusive = async (operation: () => Promise<void>): Promise<void> => {
  if (busy) return;
  busy = true;
  backButton.disabled = true;
  nextButton.disabled = true;
  cancelButton.disabled = true;
  try {
    setStatus();
    await operation();
  } catch {
    if (status.hidden)
      setStatus('本步骤未完成，请检查选项后重试；资源未就绪时可暂停或跳过。', 'error');
  } finally {
    busy = false;
    nextButton.disabled = !nextEnabled;
    backButton.disabled = !canGoBack;
    cancelButton.disabled = false;
  }
};

if (!api) {
  heading.textContent = '无法启动安装向导';
  description.textContent = '安装向导的通信接口不可用，请重新启动应用。';
  page.replaceChildren();
  stepList.replaceChildren();
  backButton.hidden = true;
  nextButton.hidden = true;
  cancelButton.hidden = true;
} else {
  const setup = api;
  nextButton.addEventListener('click', () => {
    void runExclusive(async () => {
      await currentPage?.commit?.(pageContext);
      if (isFinalStep) {
        setStatus('正在完成设置…');
        await setup.completeSetup({ selections });
        return;
      }
      await render(await setup.advanceSetup({ selections }));
    });
  });
  backButton.addEventListener('click', () => {
    void runExclusive(async () => {
      await render(await setup.goBackInSetup());
    });
  });
  cancelButton.addEventListener('click', () => {
    void runExclusive(async () => {
      await setup.cancelSetup();
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !cancelButton.hidden && !busy) {
      event.preventDefault();
      cancelButton.click();
    }
  });
  window.addEventListener('beforeunload', () => currentPage?.dispose?.());
  void runExclusive(async () => {
    await render(await setup.getSetupState());
  });
}
