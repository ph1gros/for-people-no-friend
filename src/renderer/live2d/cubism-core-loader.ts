import { CUBISM_CORE_RUNTIME_PATH } from './model-manifest';

export class CubismCoreError extends Error {
  public constructor(public readonly kind: 'unavailable' | 'invalid' | 'timeout') {
    super(
      kind === 'invalid'
        ? 'Cubism Core 文件未提供有效运行时。'
        : kind === 'timeout'
          ? 'Cubism Core 加载超时。'
          : '当前应用无法加载 Cubism Core。',
    );
    this.name = 'CubismCoreError';
  }
}

let pending: Promise<void> | undefined;
const hasCore = (): boolean =>
  Boolean((window as Window & { Live2DCubismCore?: unknown }).Live2DCubismCore);

export const loadCubismCore = (): Promise<void> => {
  if (hasCore()) return Promise.resolve();
  if (pending) return pending;
  const request = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(CUBISM_CORE_RUNTIME_PATH, window.location.href).href;
    script.async = true;
    let settled = false;
    const finish = (error?: CubismCoreError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      if (error) {
        script.remove();
        reject(error);
      } else resolve();
    };
    const onLoad = (): void => finish(hasCore() ? undefined : new CubismCoreError('invalid'));
    const onError = (): void => finish(new CubismCoreError('unavailable'));
    const timer = setTimeout(() => finish(new CubismCoreError('timeout')), 30_000);
    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    try {
      document.head.append(script);
    } catch {
      finish(new CubismCoreError('unavailable'));
    }
  });
  pending = request.finally(() => {
    pending = undefined;
  });
  return pending;
};
