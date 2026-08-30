import {
  loadCharacter,
  renderCharacterError,
  type LoadedCharacter,
} from './live2d/character-runtime';
import { initializeChat } from './chat/chat-controller';
import type { CharacterPresentationPort } from '../core/presentation/character-presentation';
import type { CharacterDisplayMode } from '../shared/character-display-ipc';
import { ViewerExPresentationClient } from './viewerex/viewerex-presentation-client';
import { VTubeStudioPresentationClient } from './vtube-studio/vtube-studio-presentation-client';

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
characterHost.hidden = true;

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
let displayMode: CharacterDisplayMode = 'off';
const viewerExPresentation = window.deskpet
  ? new ViewerExPresentationClient(window.deskpet)
  : undefined;
const vTubeStudioPresentation = window.deskpet
  ? new VTubeStudioPresentationClient(window.deskpet)
  : undefined;

const startCharacter = async (): Promise<boolean> => {
  const sequence = ++loadSequence;
  character?.dispose();
  character = undefined;
  renderLoading();

  try {
    const loaded = await loadCharacter(characterHost);
    if (sequence !== loadSequence) {
      loaded.dispose();
      return false;
    }
    character = loaded;
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

const applyDisplayMode = async (mode: CharacterDisplayMode): Promise<void> => {
  displayMode = mode;
  app.dataset.characterDisplayMode = mode;
  if (mode !== 'live2d') {
    loadSequence += 1;
    character?.dispose();
    character = undefined;
    characterHost.replaceChildren();
    characterHost.hidden = true;
    window.dispatchEvent(new Event('deskpet:character-display-changed'));
    if (mode === 'vtube-studio') await vTubeStudioPresentation?.setState('idle');
    return;
  }
  characterHost.hidden = false;
  await startCharacter();
};

const getPresentation = (): CharacterPresentationPort | undefined =>
  displayMode === 'live2d'
    ? character?.presentation
    : displayMode === 'viewerex'
      ? viewerExPresentation
      : displayMode === 'vtube-studio'
        ? vTubeStudioPresentation
        : undefined;

app.append(dragHandle, characterHost);
let disposeChat: (() => void) | undefined;
void initializeChat({
  root: app,
  getCharacter: () => character,
  getPresentation,
  onDisplayModeChanged: (mode) => void applyDisplayMode(mode),
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
window.addEventListener('deskpet:reload-character', () => {
  if (displayMode === 'live2d') void startCharacter();
});
