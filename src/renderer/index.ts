import {
  loadCharacter,
  renderCharacterError,
  type LoadedCharacter,
} from './live2d/character-runtime';
import { initializeChat } from './chat/chat-controller';

const app = document.querySelector<HTMLElement>('#app');

if (!app) {
  throw new Error('Deskpet root element is missing.');
}

const dragHandle = document.createElement('div');
dragHandle.className = 'window-drag-region';
dragHandle.setAttribute('aria-label', '拖动桌宠窗口');

const characterHost = document.createElement('main');
characterHost.className = 'character-host';
characterHost.setAttribute('aria-live', 'polite');

const renderLoading = (): void => {
  const loading = document.createElement('section');
  loading.className = 'model-loading';
  loading.textContent = '正在加载 Live2D…';
  characterHost.replaceChildren(loading);
};

let character: LoadedCharacter | undefined;
let loadSequence = 0;

const startCharacter = async (): Promise<void> => {
  const sequence = ++loadSequence;
  character?.dispose();
  character = undefined;
  renderLoading();

  try {
    const loaded = await loadCharacter(characterHost);
    if (sequence !== loadSequence) {
      loaded.dispose();
      return;
    }
    character = loaded;
    characterHost.setAttribute('aria-label', `Live2D 角色：${loaded.name}`);
    window.dispatchEvent(new Event('deskpet:character-loaded'));
  } catch (error) {
    if (sequence === loadSequence) {
      renderCharacterError(characterHost, error, () => void startCharacter());
    }
  }
};

app.append(dragHandle, characterHost);
let disposeChat: (() => void) | undefined;
void initializeChat({ root: app, getCharacter: () => character }).then((dispose) => {
  disposeChat = dispose;
});
window.addEventListener(
  'beforeunload',
  () => {
    disposeChat?.();
    character?.dispose();
  },
  { once: true },
);
void startCharacter();
