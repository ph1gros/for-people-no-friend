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
  app.classList.add('character-is-loading');
  app.style.removeProperty('--visible-frame-left');
  app.style.removeProperty('--visible-frame-top');
  app.style.removeProperty('--visible-frame-width');
  app.style.removeProperty('--visible-frame-height');
  const loading = document.createElement('section');
  loading.className = 'model-loading';
  loading.textContent = '正在加载角色…';
  characterHost.replaceChildren(loading);
};

let character: LoadedCharacter | undefined;
let loadSequence = 0;

const startCharacter = async (): Promise<boolean> => {
  const sequence = ++loadSequence;
  character?.dispose();
  character = undefined;
  renderLoading();

  try {
    const profile = await window.deskpet?.getCharacterProfile();
    const loaded = await loadCharacter(characterHost, profile?.live2dModelId);
    if (sequence !== loadSequence) {
      loaded.dispose();
      return false;
    }
    character = loaded;
    app.classList.toggle('character-is-animated-webp', loaded.renderer === 'animated-webp');
    app.classList.remove('character-is-loading');
    characterHost.setAttribute('aria-label', `桌面角色：${loaded.name}`);
    window.dispatchEvent(new Event('deskpet:character-loaded'));
    return true;
  } catch (error) {
    if (sequence === loadSequence) {
      app.classList.remove('character-is-loading');
      renderCharacterError(characterHost, error, () => void startCharacter());
    }
    return false;
  }
};

app.append(dragHandle, characterHost);
let disposeChat: (() => void) | undefined;
void initializeChat({
  root: app,
  getCharacter: () => character,
}).then((dispose) => {
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
