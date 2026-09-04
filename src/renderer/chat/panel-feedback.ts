type ButtonFeedbackState = 'pending' | 'success' | 'error';

export const createButtonFeedback = () => {
  const buttonFeedbackTimers = new Map<HTMLButtonElement, number>();

  const showButtonFeedback = (
    button: HTMLButtonElement,
    label: string,
    state: ButtonFeedbackState,
    restoreAfterMs?: number,
  ): void => {
    const existingTimer = buttonFeedbackTimers.get(button);
    if (existingTimer !== undefined) window.clearTimeout(existingTimer);
    const defaultLabel = button.dataset.defaultLabel ?? button.textContent ?? '';
    button.dataset.defaultLabel = defaultLabel;
    button.dataset.feedback = state;
    button.textContent = label;
    if (restoreAfterMs === undefined) return;
    const timer = window.setTimeout(() => {
      button.textContent = defaultLabel;
      delete button.dataset.feedback;
      buttonFeedbackTimers.delete(button);
    }, restoreAfterMs);
    buttonFeedbackTimers.set(button, timer);
  };
  return {
    showButtonFeedback,
    dispose(): void {
      for (const timer of buttonFeedbackTimers.values()) window.clearTimeout(timer);
      buttonFeedbackTimers.clear();
    },
  };
};
