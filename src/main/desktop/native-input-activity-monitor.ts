import type {
  DesktopInputActivityEvent,
  DesktopIntegrationSettings,
  InputOverlayKey,
  MouseInputDirection,
} from '../../shared/desktop-integration-ipc';

interface KeyboardHookEvent {
  keycode: number;
}

interface MouseHookEvent {
  button: unknown;
  x: number;
  y: number;
}

export interface NativeInputHook {
  on(event: 'keydown' | 'keyup', listener: (event: KeyboardHookEvent) => void): this;
  on(event: 'mousedown' | 'mouseup', listener: (event: MouseHookEvent) => void): this;
  on(event: 'mousemove', listener: (event: MouseHookEvent) => void): this;
  off(event: 'keydown' | 'keyup', listener: (event: KeyboardHookEvent) => void): this;
  off(event: 'mousedown' | 'mouseup', listener: (event: MouseHookEvent) => void): this;
  off(event: 'mousemove', listener: (event: MouseHookEvent) => void): this;
  start(): void;
  stop(): void;
}

export interface NativeInputHookModule {
  uIOhook: NativeInputHook;
  UiohookKey: Readonly<Record<string, number>>;
}

export type NativeInputHookLoader = () => Promise<NativeInputHookModule>;

const DEFAULT_HOOK_LOADER: NativeInputHookLoader = async () => {
  const module = await import('uiohook-napi');
  return {
    uIOhook: module.uIOhook,
    UiohookKey: module.UiohookKey as Readonly<Record<string, number>>,
  };
};

const directionFromVector = (x: number, y: number): MouseInputDirection => {
  const angle = Math.atan2(y, x);
  const sector = Math.round(angle / (Math.PI / 4));
  switch ((sector + 8) % 8) {
    case 0:
      return 'right';
    case 1:
      return 'down-right';
    case 2:
      return 'down';
    case 3:
      return 'down-left';
    case 4:
      return 'left';
    case 5:
      return 'up-left';
    case 6:
      return 'up';
    default:
      return 'up-right';
  }
};

export class NativeInputActivityMonitor {
  private hook: NativeInputHook | undefined;
  private listeners:
    | {
        keydown: (event: KeyboardHookEvent) => void;
        keyup: (event: KeyboardHookEvent) => void;
        mousedown: (event: MouseHookEvent) => void;
        mouseup: (event: MouseHookEvent) => void;
        mousemove: (event: MouseHookEvent) => void;
      }
    | undefined;
  private readonly pressedKeyCodes = new Set<number>();
  private pointer: { x: number; y: number } | undefined;
  private accumulatedX = 0;
  private accumulatedY = 0;
  private lastDirectionAt = 0;

  public constructor(
    private readonly loadHook: NativeInputHookLoader = DEFAULT_HOOK_LOADER,
    private readonly now: () => number = Date.now,
  ) {}

  public async start(
    settings: Pick<DesktopIntegrationSettings, 'inputOverlayKeys' | 'inputOverlayMouseEnabled'>,
    emit: (event: DesktopInputActivityEvent) => void,
  ): Promise<boolean> {
    this.stop();
    let module: NativeInputHookModule;
    try {
      module = await this.loadHook();
    } catch {
      return false;
    }
    const keyCodes = this.buildKeyCodeMap(module.UiohookKey, settings.inputOverlayKeys);
    const keydown = (event: KeyboardHookEvent): void => {
      const key = keyCodes.get(event.keycode);
      if (!key || this.pressedKeyCodes.has(event.keycode)) return;
      this.pressedKeyCodes.add(event.keycode);
      emit({ type: 'key', key, pressed: true });
    };
    const keyup = (event: KeyboardHookEvent): void => {
      const key = keyCodes.get(event.keycode);
      if (!key || !this.pressedKeyCodes.delete(event.keycode)) return;
      emit({ type: 'key', key, pressed: false });
    };
    const emitMouseButton = (event: MouseHookEvent, pressed: boolean): void => {
      if (!settings.inputOverlayMouseEnabled) return;
      const button =
        event.button === 1
          ? 'left'
          : event.button === 2
            ? 'right'
            : event.button === 3
              ? 'middle'
              : undefined;
      if (button) emit({ type: 'mouse-button', button, pressed });
    };
    const mousedown = (event: MouseHookEvent): void => emitMouseButton(event, true);
    const mouseup = (event: MouseHookEvent): void => emitMouseButton(event, false);
    const mousemove = (event: MouseHookEvent): void => {
      if (!settings.inputOverlayMouseEnabled) return;
      if (!this.pointer) {
        this.pointer = { x: event.x, y: event.y };
        return;
      }
      this.accumulatedX += event.x - this.pointer.x;
      this.accumulatedY += event.y - this.pointer.y;
      this.pointer = { x: event.x, y: event.y };
      const now = this.now();
      if (
        now - this.lastDirectionAt < 50 ||
        Math.hypot(this.accumulatedX, this.accumulatedY) < 12
      ) {
        return;
      }
      emit({
        type: 'mouse-direction',
        direction: directionFromVector(this.accumulatedX, this.accumulatedY),
      });
      this.accumulatedX = 0;
      this.accumulatedY = 0;
      this.lastDirectionAt = now;
    };
    try {
      module.uIOhook.on('keydown', keydown);
      module.uIOhook.on('keyup', keyup);
      module.uIOhook.on('mousedown', mousedown);
      module.uIOhook.on('mouseup', mouseup);
      module.uIOhook.on('mousemove', mousemove);
      module.uIOhook.start();
      this.hook = module.uIOhook;
      this.listeners = { keydown, keyup, mousedown, mouseup, mousemove };
      return true;
    } catch {
      this.detach(module.uIOhook, { keydown, keyup, mousedown, mouseup, mousemove });
      return false;
    }
  }

  public stop(): void {
    if (this.hook && this.listeners) this.detach(this.hook, this.listeners);
    this.hook = undefined;
    this.listeners = undefined;
    this.pressedKeyCodes.clear();
    this.pointer = undefined;
    this.accumulatedX = 0;
    this.accumulatedY = 0;
    this.lastDirectionAt = 0;
  }

  private buildKeyCodeMap(
    source: Readonly<Record<string, number>>,
    keys: readonly InputOverlayKey[],
  ): Map<number, InputOverlayKey> {
    const result = new Map<number, InputOverlayKey>();
    for (const key of keys) {
      const keyCode = source[key];
      if (typeof keyCode === 'number') result.set(keyCode, key);
      if (key === 'Shift' && typeof source.ShiftRight === 'number') {
        result.set(source.ShiftRight, key);
      }
      if (key === 'Ctrl' && typeof source.CtrlRight === 'number') {
        result.set(source.CtrlRight, key);
      }
      if (key === 'Alt' && typeof source.AltRight === 'number') {
        result.set(source.AltRight, key);
      }
    }
    return result;
  }

  private detach(
    hook: NativeInputHook,
    listeners: NonNullable<NativeInputActivityMonitor['listeners']>,
  ): void {
    hook.off('keydown', listeners.keydown);
    hook.off('keyup', listeners.keyup);
    hook.off('mousedown', listeners.mousedown);
    hook.off('mouseup', listeners.mouseup);
    hook.off('mousemove', listeners.mousemove);
    try {
      hook.stop();
    } catch {
      // Native input display is optional; a failed stop must not block app shutdown.
    }
  }
}
