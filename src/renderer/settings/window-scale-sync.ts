import type { DeskpetApi } from '../../shared/ipc';

type WindowScaleApi = Pick<
  DeskpetApi,
  'getWindowScale' | 'setWindowScale' | 'onWindowScaleChanged'
>;

export class WindowScaleSync {
  private readonly disposeListener: () => void;

  public constructor(
    private readonly api: WindowScaleApi,
    private readonly display: (scale: number) => void,
  ) {
    this.disposeListener = api.onWindowScaleChanged((scale) => this.display(scale));
  }

  public async load(): Promise<number> {
    const scale = await this.api.getWindowScale();
    this.display(scale);
    return scale;
  }

  public preview(scale: number): void {
    this.display(scale);
  }

  public async commit(scale: number): Promise<number> {
    const appliedScale = await this.api.setWindowScale({ scale });
    this.display(appliedScale);
    return appliedScale;
  }

  public dispose(): void {
    this.disposeListener();
  }
}
