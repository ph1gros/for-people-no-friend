/** Own listeners at the same lifetime as their panel or a replaceable rendered list. */
export const createPanelLifetime = () => {
  let disposed = false;
  const cleanups: Array<() => void> = [];
  return {
    get disposed() {
      return disposed;
    },
    on(target: EventTarget, type: string, listener: EventListener): void {
      if (disposed) return;
      target.addEventListener(type, listener);
      cleanups.push(() => target.removeEventListener(type, listener));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    },
  };
};
