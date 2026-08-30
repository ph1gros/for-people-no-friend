export const COMPANION_DROWSY_DELAY_MS = 5 * 60 * 1_000;

export interface KittenDrowsyLine {
  displayText: string;
  speechText: string;
}

const KITTEN_DROWSY_LINES: readonly KittenDrowsyLine[] = Object.freeze([
  {
    displayText: '你怎么还不来找我……我都快睡着了。',
    speechText: 'まだ来てくれないの……もう寝ちゃいそう。',
  },
  {
    displayText: '我只是闭会儿眼……才不是在等你。',
    speechText: 'ちょっと目を閉じてるだけ……別に、あなたを待ってるわけじゃないから。',
  },
  {
    displayText: '再不理我，我就先眯一会儿了……你回来要叫我。',
    speechText: 'もう少しだけ寝るね……戻ってきたら、ちゃんと起こして。',
  },
]);

type Timer = ReturnType<typeof setTimeout>;

export const selectKittenDrowsyLine = (random = Math.random): KittenDrowsyLine => {
  const bounded = Math.min(1, Math.max(0, random()));
  const index = Math.min(
    KITTEN_DROWSY_LINES.length - 1,
    Math.floor(bounded * KITTEN_DROWSY_LINES.length),
  );
  return KITTEN_DROWSY_LINES[index]!;
};

/** Fires once after a full quiet period; a user turn arms the next quiet period. */
export class IdleCompanionScheduler {
  private timer: Timer | undefined;
  private destroyed = false;

  public constructor(
    private readonly onIdle: () => void,
    private readonly delayMs = COMPANION_DROWSY_DELAY_MS,
  ) {}

  public start(): void {
    if (this.destroyed || this.timer !== undefined) return;
    this.schedule();
  }

  public reset(): void {
    if (this.destroyed) return;
    if (this.timer !== undefined) globalThis.clearTimeout(this.timer);
    this.timer = undefined;
    this.schedule();
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.timer !== undefined) globalThis.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    this.timer = globalThis.setTimeout(() => {
      this.timer = undefined;
      if (!this.destroyed) this.onIdle();
    }, this.delayMs);
  }
}
