/** Own listeners at the same lifetime as their panel or a replaceable rendered list. */
export const createPanelLifetime = () => {
  let disposed = false;
  const cleanups: Array<() => void> = [];
  const delays = new Map<number, () => void>();
  return {
    get disposed() {
      return disposed;
    },
    on(target: EventTarget, type: string, listener: EventListener): void {
      if (disposed) return;
      target.addEventListener(type, listener);
      cleanups.push(() => target.removeEventListener(type, listener));
    },
    delay(milliseconds: number): Promise<void> {
      if (disposed) return Promise.resolve();
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          delays.delete(timer);
          resolve();
        }, milliseconds);
        delays.set(timer, resolve);
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const [timer, resolve] of delays) {
        window.clearTimeout(timer);
        resolve();
      }
      delays.clear();
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    },
  };
};
