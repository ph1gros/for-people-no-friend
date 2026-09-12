import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVoiceSample, stopVoiceSample } from '../src/renderer/speech/voice-sample';

class Element extends EventTarget {
  children: Element[] = [];
  textContent = '';
  disabled = false;
  src = '';
  play = vi.fn(async () => undefined);
  pause = vi.fn();
  setAttribute(): void {}
  append(...items: Element[]): void {
    this.children.push(...items);
  }
}
const build = () => {
  const audio: Element[] = [];
  const doc = {
    createElement: (tag: string) => {
      const el = new Element();
      if (tag === 'audio') audio.push(el);
      return el;
    },
  } as unknown as Document;
  const samples = { './samples/voice-ireina.wav': '/fixed-sample.wav' };
  return { audio, doc, samples };
};
afterEach(stopVoiceSample);
describe('pre-download voice samples', () => {
  it('plays only on click, stops the previous sample, and ignores stale ended events', async () => {
    const { audio, doc, samples } = build();
    const first = createVoiceSample('voice-ireina', doc, samples) as unknown as Element;
    const second = createVoiceSample('voice-ireina', doc, samples) as unknown as Element;
    expect(audio).toHaveLength(0);
    first.children[0].dispatchEvent(new Event('click'));
    expect(audio[0].play).toHaveBeenCalledOnce();
    second.children[0].dispatchEvent(new Event('click'));
    expect(audio[0].pause).toHaveBeenCalledOnce();
    audio[0].dispatchEvent(new Event('ended'));
    expect(second.children[0].textContent).toBe('停止试听');
    stopVoiceSample();
    expect(audio[1].pause).toHaveBeenCalledOnce();
    expect(second.children[0].textContent).toBe('试听一句');
  });
  it('reports missing bundled audio without starting playback', () => {
    const { audio, doc } = build();
    const root = createVoiceSample('voice-ireina', doc, {}) as unknown as Element;
    expect(root.children[0].disabled).toBe(true);
    root.children[0].dispatchEvent(new Event('click'));
    expect(audio).toHaveLength(0);
    expect(root.children[1].textContent).toContain('暂未附带');
  });
  it('recovers from playback failure and permits retry', async () => {
    const { audio, doc, samples } = build();
    const root = createVoiceSample('voice-ireina', doc, samples) as unknown as Element;
    root.children[0].dispatchEvent(new Event('click'));
    audio[0].dispatchEvent(new Event('error'));
    expect(root.children[1].textContent).toContain('请重试');
    root.children[0].dispatchEvent(new Event('click'));
    expect(audio[1].play).toHaveBeenCalledOnce();
  });
});
