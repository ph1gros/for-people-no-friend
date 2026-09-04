import type { ConversationMessage } from '../../shared/conversation-ipc';

export interface ConversationTimeline {
  render(messages: readonly ConversationMessage[], activeReply?: string): void;
  appendDelta(delta: string): void;
  clearActiveReply(): void;
  dispose(): void;
}

interface ConversationTimelineEnvironment {
  document: Document;
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
}

const createMessageNode = (
  document: Document,
  message: Pick<ConversationMessage, 'role' | 'content' | 'status'>,
): { item: HTMLElement; content: HTMLParagraphElement } => {
  const item = document.createElement('article');
  item.className = `conversation-message conversation-message--${message.role}`;
  const content = document.createElement('p');
  content.textContent = message.content;
  item.append(content);
  if (message.status === 'cancelled') {
    const status = document.createElement('small');
    status.textContent = '已停止';
    item.append(status);
  }
  return { item, content };
};

export const mountConversationTimeline = (
  root: HTMLElement,
  environment: ConversationTimelineEnvironment = {
    document: root.ownerDocument,
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
  },
): ConversationTimeline => {
  let activeReplyNode: HTMLElement | undefined;
  let activeReplyTextNode: HTMLParagraphElement | undefined;
  let emptyNode: HTMLElement | undefined;
  let pendingScrollFrame: number | undefined;

  const cancelPendingScroll = (): void => {
    if (pendingScrollFrame === undefined) return;
    environment.cancelFrame(pendingScrollFrame);
    pendingScrollFrame = undefined;
  };

  const scheduleScrollToBottom = (wasNearBottom: boolean): void => {
    if (!wasNearBottom || pendingScrollFrame !== undefined) return;
    pendingScrollFrame = environment.requestFrame(() => {
      pendingScrollFrame = undefined;
      root.scrollTop = root.scrollHeight;
    });
  };

  const createEmptyNode = (): HTMLElement => {
    const empty = environment.document.createElement('p');
    empty.className = 'conversation-list__empty';
    empty.textContent = '还没有对话，开始聊吧。';
    return empty;
  };

  const ensureActiveReplyNode = (): HTMLParagraphElement => {
    if (activeReplyTextNode) return activeReplyTextNode;
    emptyNode?.remove();
    emptyNode = undefined;
    const active = createMessageNode(environment.document, {
      role: 'assistant',
      content: '',
      status: 'complete',
    });
    root.append(active.item);
    activeReplyNode = active.item;
    activeReplyTextNode = active.content;
    return active.content;
  };

  const clearActiveReply = (): void => {
    activeReplyNode?.remove();
    activeReplyNode = undefined;
    activeReplyTextNode = undefined;
  };

  return {
    render(messages, activeReply = '') {
      cancelPendingScroll();
      activeReplyNode = undefined;
      activeReplyTextNode = undefined;
      emptyNode = undefined;
      root.replaceChildren();
      for (const message of messages) {
        root.append(createMessageNode(environment.document, message).item);
      }
      if (activeReply) {
        const active = createMessageNode(environment.document, {
          role: 'assistant',
          content: activeReply,
          status: 'complete',
        });
        root.append(active.item);
        activeReplyNode = active.item;
        activeReplyTextNode = active.content;
      }
      if (root.children.length === 0) {
        emptyNode = createEmptyNode();
        root.append(emptyNode);
      }
      root.scrollTop = root.scrollHeight;
    },
    appendDelta(delta) {
      const wasNearBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 48;
      const content = ensureActiveReplyNode();
      content.textContent = `${content.textContent ?? ''}${delta}`;
      scheduleScrollToBottom(wasNearBottom);
    },
    clearActiveReply,
    dispose() {
      cancelPendingScroll();
      clearActiveReply();
      emptyNode = undefined;
    },
  };
};
