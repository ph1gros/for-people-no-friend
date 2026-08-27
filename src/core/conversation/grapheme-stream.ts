export class GraphemeStreamBuffer {
  private pending = '';
  private readonly segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

  public push(chunk: string): string {
    if (!chunk) return '';
    const combined = this.pending + chunk;
    const segments = [...this.segmenter.segment(combined)].map(({ segment }) => segment);
    if (segments.length <= 1) {
      this.pending = combined;
      return '';
    }
    this.pending = segments.pop() ?? '';
    return segments.join('');
  }

  public finish(): string {
    const remaining = this.pending;
    this.pending = '';
    return remaining;
  }
}
