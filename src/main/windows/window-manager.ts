import { app, type BrowserWindow, screen } from 'electron';

import { IPC_CHANNELS } from '../../shared/ipc';

import { configureMainWindowLayout, createMainWindow } from './create-main-window';
import {
  boundsToState,
  createDefaultWindowState,
  keepWindowVisible,
  resizeStateAroundCenter,
  stateToBounds,
  type PersistedWindowState,
  WindowStateStore,
} from './window-state';

const SAVE_DELAY_MS = 250;

export class WindowManager {
  private window: BrowserWindow | undefined;
  private saveTimer: NodeJS.Timeout | undefined;
  private isQuitting = false;
  private chatPanelExpanded = false;
  private collapsedStateBeforeExpansion: PersistedWindowState | undefined;
  private expandedOrigin: PersistedWindowState | undefined;
  private readonly store = new WindowStateStore(app.getPath('userData'));

  private readonly handleDisplayChange = (): void => {
    this.ensureVisible();
  };

  public create(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }

    const primaryWorkArea = screen.getPrimaryDisplay().workArea;
    const savedState = this.store.load() ?? createDefaultWindowState(primaryWorkArea);
    const visibleState = keepWindowVisible(savedState, screen.getAllDisplays(), primaryWorkArea);
    const window = createMainWindow(visibleState);
    this.window = window;

    window.on('move', () => this.scheduleSave());
    window.on('resize', () => {
      this.scheduleSave();
      this.notifyScaleChanged();
    });
    window.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        window.hide();
      }
    });
    window.on('closed', () => {
      this.window = undefined;
    });
    window.once('ready-to-show', () => window.show());

    screen.on('display-added', this.handleDisplayChange);
    screen.on('display-removed', this.handleDisplayChange);
    screen.on('display-metrics-changed', this.handleDisplayChange);

    return window;
  }

  public getWindow(): BrowserWindow | undefined {
    return this.window && !this.window.isDestroyed() ? this.window : undefined;
  }

  public show(): void {
    const window = this.getWindow() ?? this.create();
    this.ensureVisible();
    window.show();
    window.focus();
  }

  public hide(): void {
    this.getWindow()?.hide();
  }

  public toggleVisibility(): void {
    const window = this.getWindow();
    if (window?.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  public getScale(): number {
    const window = this.getWindow();
    return window ? boundsToState(window.getBounds()).scale : 1;
  }

  public setScale(scale: number): number {
    const window = this.getWindow() ?? this.create();
    const centered = resizeStateAroundCenter(
      boundsToState(window.getBounds()),
      scale,
      this.chatPanelExpanded,
    );
    const visible = keepWindowVisible(
      centered,
      screen.getAllDisplays(),
      screen.getPrimaryDisplay().workArea,
      this.chatPanelExpanded,
    );
    window.setBounds(stateToBounds(visible, this.chatPanelExpanded));
    this.scheduleSave();
    return visible.scale;
  }

  public setChatPanelExpanded(expanded: boolean): void {
    if (this.chatPanelExpanded === expanded) return;
    const window = this.getWindow() ?? this.create();
    const current = boundsToState(window.getBounds());
    const target = expanded ? current : this.deriveCollapsedState(current);
    if (expanded) this.collapsedStateBeforeExpansion = current;
    this.chatPanelExpanded = expanded;
    if (expanded) configureMainWindowLayout(window, true);
    const visible = keepWindowVisible(
      target,
      screen.getAllDisplays(),
      screen.getPrimaryDisplay().workArea,
      expanded,
    );
    window.setBounds(stateToBounds(visible, expanded));
    if (expanded) {
      this.expandedOrigin = visible;
    } else {
      configureMainWindowLayout(window, false);
      this.collapsedStateBeforeExpansion = undefined;
      this.expandedOrigin = undefined;
    }
    this.scheduleSave();
  }

  public prepareToQuit(): void {
    this.isQuitting = true;
    this.flushSave();
    screen.removeListener('display-added', this.handleDisplayChange);
    screen.removeListener('display-removed', this.handleDisplayChange);
    screen.removeListener('display-metrics-changed', this.handleDisplayChange);
  }

  private ensureVisible(): void {
    const window = this.getWindow();
    if (!window || window.isMinimized()) {
      return;
    }

    const visibleState = keepWindowVisible(
      boundsToState(window.getBounds()),
      screen.getAllDisplays(),
      screen.getPrimaryDisplay().workArea,
      this.chatPanelExpanded,
    );
    window.setBounds(stateToBounds(visibleState, this.chatPanelExpanded));
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => this.flushSave(), SAVE_DELAY_MS);
  }

  private notifyScaleChanged(): void {
    const window = this.getWindow();
    if (!window || window.webContents.isDestroyed()) return;
    window.webContents.send(IPC_CHANNELS.windowScaleChanged, this.getScale());
  }

  private flushSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }

    const window = this.getWindow();
    if (!window || window.isMinimized() || window.isMaximized()) {
      return;
    }

    try {
      this.store.save(this.deriveCollapsedState(boundsToState(window.getBounds())));
    } catch (error) {
      console.warn('Unable to save the deskpet window state.', error);
    }
  }

  private deriveCollapsedState(current: PersistedWindowState): PersistedWindowState {
    if (!this.chatPanelExpanded || !this.collapsedStateBeforeExpansion || !this.expandedOrigin) {
      return current;
    }
    const collapsedAtScale = resizeStateAroundCenter(
      this.collapsedStateBeforeExpansion,
      current.scale,
    );
    const expandedAtScale = resizeStateAroundCenter(this.expandedOrigin, current.scale, true);
    return {
      ...current,
      x: collapsedAtScale.x + current.x - expandedAtScale.x,
      y: collapsedAtScale.y + current.y - expandedAtScale.y,
    };
  }
}
