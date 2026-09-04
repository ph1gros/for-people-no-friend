import {
  MAX_DROPPED_WORKSPACE_FILES,
  MAX_DROPPED_WORKSPACE_FILE_BYTES,
  MAX_DROPPED_WORKSPACE_TOTAL_BYTES,
} from '../../shared/assistant-tools-ipc';

export interface ComposerImportResult {
  ok: boolean;
  imported: readonly unknown[];
  message: string;
}

export interface ComposerPanelDeps {
  document?: Document;
  window?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  setTimeout?: (callback: () => void, milliseconds: number) => number;
  clearTimeout?: (timer: number) => void;
  isChatView(): boolean;
  isAssistantModeEnabled(): boolean;
  isWorkspaceConfigured(): boolean;
  importFiles(files: Array<{ name: string; bytes: Uint8Array }>): Promise<ComposerImportResult>;
  onFilesImported(result: ComposerImportResult): void;
  onSubmit(message: string): boolean;
  onStop(): void;
  onStopSpeech(): void;
  onMicrophone(): void | Promise<void>;
}

export interface MountedComposerPanel {
  root: HTMLFormElement;
  input: HTMLTextAreaElement;
  sendButton: HTMLButtonElement;
  microphoneButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  stopSpeechButton: HTMLButtonElement;
  showDropStatus(message: string, clearAfterMs?: number): void;
  dispose(): void;
}

const createButton = (
  documentRef: Document,
  label: string,
  className: string,
): HTMLButtonElement => {
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
};

export const mountComposerPanel = (
  dropTarget: HTMLElement,
  deps: ComposerPanelDeps,
): MountedComposerPanel => {
  const documentRef = deps.document ?? document;
  const windowRef = deps.window ?? window;
  const setTimer =
    deps.setTimeout ?? ((callback, milliseconds) => window.setTimeout(callback, milliseconds));
  const clearTimer = deps.clearTimeout ?? ((timer) => window.clearTimeout(timer));
  const root = documentRef.createElement('form');
  root.className = 'chat-composer';
  const input = documentRef.createElement('textarea');
  input.className = 'chat-composer__input';
  input.placeholder = '输入消息或任务…';
  input.maxLength = 16_000;
  input.rows = 1;
  input.setAttribute('aria-label', '对话内容');
  const sendButton = createButton(documentRef, '发送', 'chat-composer__send');
  sendButton.type = 'submit';
  const microphoneButton = createButton(documentRef, '说话', 'chat-composer__microphone');
  microphoneButton.hidden = true;
  microphoneButton.title = '手动开始录音；再次点击结束并把中文填入输入框';
  microphoneButton.setAttribute('aria-pressed', 'false');
  const stopButton = createButton(documentRef, '停止', 'chat-composer__stop');
  stopButton.hidden = true;
  const stopSpeechButton = createButton(documentRef, '停声', 'chat-composer__stop');
  stopSpeechButton.hidden = true;
  stopSpeechButton.title = '立即停止后续语音和当前播放';
  stopSpeechButton.classList.add('chat-composer__stop-speech');
  const dropStatus = documentRef.createElement('small');
  dropStatus.className = 'chat-composer__drop-status';
  const actions = documentRef.createElement('div');
  actions.className = 'chat-composer__actions';
  actions.append(microphoneButton, stopSpeechButton, stopButton, sendButton);
  root.append(input, dropStatus, actions);

  let statusTimer: number | undefined;
  const showDropStatus = (message: string, clearAfterMs = 2_500): void => {
    if (statusTimer !== undefined) clearTimer(statusTimer);
    statusTimer = undefined;
    dropStatus.textContent = message;
    if (!message || clearAfterMs <= 0) return;
    statusTimer = setTimer(() => {
      dropStatus.textContent = '';
      statusTimer = undefined;
    }, clearAfterMs);
  };
  const containsFiles = (event: DragEvent): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');
  const containsText = (event: DragEvent): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes('text/plain');
  const containsSupportedDrop = (event: DragEvent): boolean =>
    containsFiles(event) || containsText(event);
  const preventWindowFileNavigation = (event: Event): void => {
    if (containsFiles(event as DragEvent)) event.preventDefault();
  };
  const handleDragOver = (event: Event): void => {
    const dragEvent = event as DragEvent;
    if (!deps.isChatView() || !containsSupportedDrop(dragEvent)) return;
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    if (dragEvent.dataTransfer) dragEvent.dataTransfer.dropEffect = 'copy';
    dropTarget.classList.add('is-drop-active');
  };
  const handleDragLeave = (event: Event): void => {
    const next = (event as DragEvent).relatedTarget;
    if (!(next instanceof Node) || !dropTarget.contains(next)) {
      dropTarget.classList.remove('is-drop-active');
    }
  };
  const handleDrop = (event: Event): void => {
    const dragEvent = event as DragEvent;
    if (!deps.isChatView() || !containsSupportedDrop(dragEvent)) return;
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    dropTarget.classList.remove('is-drop-active');
    if (!deps.isAssistantModeEnabled()) {
      showDropStatus('请先开启工作模式，再拖入文本或文件');
      return;
    }
    if (!containsFiles(dragEvent)) {
      const droppedText = dragEvent.dataTransfer?.getData('text/plain').trim() ?? '';
      if (!droppedText) return;
      const separator = input.value && !input.value.endsWith('\n') ? '\n' : '';
      const remainingLength = input.maxLength - input.value.length - separator.length;
      if (remainingLength <= 0) {
        showDropStatus('输入内容已达到长度上限');
        return;
      }
      input.value += `${separator}${droppedText.slice(0, remainingLength)}`;
      input.focus();
      showDropStatus('已把拖入文本放进输入框');
      return;
    }
    void (async () => {
      if (!deps.isWorkspaceConfigured()) {
        showDropStatus('请先在设置中选择工作区');
        return;
      }
      const files = Array.from(dragEvent.dataTransfer?.files ?? []);
      if (files.length === 0 || files.length > MAX_DROPPED_WORKSPACE_FILES) {
        showDropStatus(`一次最多拖入 ${MAX_DROPPED_WORKSPACE_FILES} 个文件`);
        return;
      }
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      if (files.some((file) => file.size > MAX_DROPPED_WORKSPACE_FILE_BYTES)) {
        showDropStatus('单个文件不能超过 16 MB');
        return;
      }
      if (totalBytes > MAX_DROPPED_WORKSPACE_TOTAL_BYTES) {
        showDropStatus('本次文件总大小不能超过 64 MB');
        return;
      }
      showDropStatus('正在放入工作区…', 0);
      try {
        const result = await deps.importFiles(
          await Promise.all(
            files.map(async (file) => ({
              name: file.name,
              bytes: new Uint8Array(await file.arrayBuffer()),
            })),
          ),
        );
        showDropStatus(result.message);
        deps.onFilesImported(result);
      } catch {
        showDropStatus('文件导入失败，聊天仍可继续');
      }
    })();
  };
  const handleSubmit = (event: Event): void => {
    event.preventDefault();
    const message = input.value.trim();
    if (message && deps.onSubmit(message)) input.value = '';
  };
  const handleStop = (): void => deps.onStop();
  const handleStopSpeech = (): void => deps.onStopSpeech();
  const handleMicrophone = (): void => void deps.onMicrophone();

  windowRef.addEventListener('dragover', preventWindowFileNavigation);
  windowRef.addEventListener('drop', preventWindowFileNavigation);
  dropTarget.addEventListener('dragover', handleDragOver);
  dropTarget.addEventListener('dragleave', handleDragLeave);
  dropTarget.addEventListener('drop', handleDrop);
  root.addEventListener('submit', handleSubmit);
  stopButton.addEventListener('click', handleStop);
  stopSpeechButton.addEventListener('click', handleStopSpeech);
  microphoneButton.addEventListener('click', handleMicrophone);

  return {
    root,
    input,
    sendButton,
    microphoneButton,
    stopButton,
    stopSpeechButton,
    showDropStatus,
    dispose: () => {
      if (statusTimer !== undefined) clearTimer(statusTimer);
      statusTimer = undefined;
      windowRef.removeEventListener('dragover', preventWindowFileNavigation);
      windowRef.removeEventListener('drop', preventWindowFileNavigation);
      dropTarget.removeEventListener('dragover', handleDragOver);
      dropTarget.removeEventListener('dragleave', handleDragLeave);
      dropTarget.removeEventListener('drop', handleDrop);
      root.removeEventListener('submit', handleSubmit);
      stopButton.removeEventListener('click', handleStop);
      stopSpeechButton.removeEventListener('click', handleStopSpeech);
      microphoneButton.removeEventListener('click', handleMicrophone);
    },
  };
};
