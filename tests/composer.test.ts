import { describe, expect, it, vi } from 'vitest';

import { mountComposerPanel } from '../src/renderer/chat/composer';

class FakeClassList {
  private readonly values = new Set<string>();

  public add(...values: string[]): void {
    values.forEach((value) => this.values.add(value));
  }

  public remove(...values: string[]): void {
    values.forEach((value) => this.values.delete(value));
  }

  public contains(value: string): boolean {
    return this.values.has(value);
  }
}

class FakeElement extends EventTarget {
  public children: FakeElement[] = [];
  public className = '';
  public classList = new FakeClassList();
  public textContent = '';
  public value = '';
  public hidden = false;
  public disabled = false;
  public type = '';
  public title = '';
  public placeholder = '';
  public maxLength = 0;
  public rows = 0;

  public append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  public setAttribute(): void {}
  public focus(): void {}
}

const fakeDocument = {
  createElement: () => new FakeElement(),
} as unknown as Document;

describe('composer panel', () => {
  it('owns submit, controls, dropped text, and removes every listener on dispose', () => {
    const windowTarget = new EventTarget();
    const panel = new FakeElement();
    const onSubmit = vi.fn(() => true);
    const onStop = vi.fn();
    const onMicrophone = vi.fn();
    const clearTimeout = vi.fn();
    const composer = mountComposerPanel(panel as unknown as HTMLElement, {
      document: fakeDocument,
      window: windowTarget,
      setTimeout: vi.fn(() => 41),
      clearTimeout,
      isChatView: () => true,
      isAssistantModeEnabled: () => true,
      isWorkspaceConfigured: () => true,
      importFiles: vi.fn(),
      onFilesImported: vi.fn(),
      onSubmit,
      onStop,
      onStopSpeech: vi.fn(),
      onMicrophone,
    });

    expect(composer.root.className).toBe('chat-composer');
    expect(composer.input.className).toBe('chat-composer__input');
    composer.input.value = '  hello  ';
    composer.root.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(onSubmit).toHaveBeenCalledWith('hello');
    expect(composer.input.value).toBe('');

    composer.stopButton.dispatchEvent(new Event('click'));
    composer.microphoneButton.dispatchEvent(new Event('click'));
    expect(onStop).toHaveBeenCalledOnce();
    expect(onMicrophone).toHaveBeenCalledOnce();

    const drop = new Event('drop', { cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        types: ['text/plain'],
        getData: () => 'dropped text',
        files: [],
        dropEffect: 'none',
      },
    });
    panel.dispatchEvent(drop);
    expect(composer.input.value).toBe('dropped text');

    composer.showDropStatus('done');
    composer.dispose();
    expect(clearTimeout).toHaveBeenCalledWith(41);
    composer.stopButton.dispatchEvent(new Event('click'));
    expect(onStop).toHaveBeenCalledOnce();
  });
});
