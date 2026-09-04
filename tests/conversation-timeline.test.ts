import { describe, expect, it } from 'vitest';

import { mountConversationTimeline } from '../src/renderer/chat/timeline';

class FakeElement {
  public children: FakeElement[] = [];
  public className = '';
  public textContent = '';
  public scrollHeight = 0;
  public scrollTop = 0;
  public clientHeight = 0;
  public parent?: FakeElement;

  public append(...children: FakeElement[]): void {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }

  public replaceChildren(...children: FakeElement[]): void {
    for (const child of this.children) child.parent = undefined;
    this.children = [];
    this.append(...children);
  }

  public remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = undefined;
  }
}

class FakeDocument {
  public createElement(): FakeElement {
    return new FakeElement();
  }
}

const createHarness = () => {
  const frames = new Map<number, () => void>();
  let nextFrame = 1;
  const root = new FakeElement();
  const timeline = mountConversationTimeline(root as unknown as HTMLElement, {
    document: new FakeDocument() as unknown as Document,
    requestFrame: (callback) => {
      const id = nextFrame;
      nextFrame += 1;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => frames.delete(id),
  });
  return {
    frames,
    root,
    timeline,
    flushFrames: () => {
      for (const callback of [...frames.values()]) callback();
      frames.clear();
    },
  };
};

describe('conversation timeline', () => {
  it('keeps historical nodes stable while appending streaming deltas to one assistant node', () => {
    const { root, timeline, flushFrames } = createHarness();
    timeline.render([
      {
        id: 'user-1',
        role: 'user',
        content: '你好',
        createdAt: 1,
        status: 'complete',
      },
    ]);
    const historicalNode = root.children[0];

    timeline.appendDelta('第');
    timeline.appendDelta('二');
    timeline.appendDelta('句');
    flushFrames();

    expect(root.children).toHaveLength(2);
    expect(root.children[0]).toBe(historicalNode);
    expect(root.children[1]?.className).toContain('conversation-message--assistant');
    expect(root.children[1]?.children[0]?.textContent).toBe('第二句');
  });

  it('does not pull the user back down after they scroll away from the bottom', () => {
    const { root, timeline, flushFrames } = createHarness();
    root.scrollHeight = 1_000;
    root.clientHeight = 200;
    root.scrollTop = 200;

    timeline.appendDelta('继续回复');
    flushFrames();

    expect(root.scrollTop).toBe(200);
  });

  it('coalesces bottom-following scroll work and cancels it on dispose', () => {
    const { frames, root, timeline } = createHarness();
    root.scrollHeight = 400;
    root.clientHeight = 200;
    root.scrollTop = 200;

    timeline.appendDelta('一');
    timeline.appendDelta('二');
    expect(frames.size).toBe(1);
    timeline.dispose();
    expect(frames.size).toBe(0);
  });
});
