import type { SpeechAssetTierId } from '../../shared/speech-asset-ipc';
import genieNotice from './samples/GENIE-LICENSE.txt?raw';
import ireinaNotice from './samples/IREINA-LICENSE.txt?raw';

// Only explicitly supplied local preview files; never start a speech engine.
const samples = import.meta.glob<string>('./samples/*.wav', {
  eager: true,
  query: '?url',
  import: 'default',
});
let active: (() => void) | undefined;
export const stopVoiceSample = (): void => active?.();

export const createVoiceSample = (
  id: SpeechAssetTierId,
  doc: Document,
  bundledSamples: Readonly<Record<string, string>> = samples,
): HTMLElement => {
  const root = doc.createElement('div');
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'secondary-button';
  button.textContent = '试听一句';
  const status = doc.createElement('span');
  status.setAttribute('role', 'status');
  const url = bundledSamples[`./samples/${id}.wav`];
  button.disabled = !url;
  if (!url) status.textContent = '此版本暂未附带试听音频';
  let audio: HTMLAudioElement | undefined;
  let revision = 0;
  const stop = (): void => {
    revision += 1;
    audio?.pause();
    audio = undefined;
    button.textContent = '试听一句';
    if (active === stop) active = undefined;
  };
  button.addEventListener('click', () => {
    if (audio) {
      stop();
      return;
    }
    if (!url) return;
    stopVoiceSample();
    active = stop;
    const current = ++revision;
    audio = doc.createElement('audio');
    audio.preload = 'none';
    audio.src = url;
    audio.addEventListener('ended', () => {
      if (revision === current) stop();
    });
    const failed = (): void => {
      if (revision !== current) return;
      stop();
      status.textContent = '试听暂时无法播放，请重试。';
    };
    audio.addEventListener('error', failed);
    button.textContent = '停止试听';
    status.textContent = '';
    void audio.play().catch(failed);
  });
  root.append(button, status);
  const details = doc.createElement('details');
  const summary = doc.createElement('summary');
  summary.textContent = '试听素材来源与使用说明';
  const notice = doc.createElement('p');
  notice.textContent = id === 'voice-ireina' ? ireinaNotice : genieNotice;
  details.append(summary, notice);
  root.append(details);
  return root;
};
