import { describe, expect, it } from 'vitest';

import {
  buildViewerExPresentationMessages,
  sanitizeViewerExBubbleText,
} from '../src/main/viewerex/viewerex-protocol';
import { DEFAULT_VIEWEREX_SETTINGS } from '../src/shared/viewerex-ipc';

describe('ViewerEX ExAPI protocol adapter', () => {
  it('renders model text as bounded plain text instead of Unity rich text', () => {
    const source = `<b>你好</b>\u0000${'界'.repeat(1_200)}`;
    const sanitized = sanitizeViewerExBubbleText(source);

    expect(sanitized.startsWith('＜b＞你好＜/b＞')).toBe(true);
    expect(sanitized).not.toContain('\u0000');
    expect([...sanitized]).toHaveLength(1_000);
  });

  it('uses only safe ExAPI variants and configured mappings', () => {
    const messages = buildViewerExPresentationMessages(
      {
        ...DEFAULT_VIEWEREX_SETTINGS,
        enabled: true,
        modelIndex: 2,
        stateMotions: { talking: 'talk:default' },
        emotionExpressions: { happy: 4 },
        actionMotions: { wave: 'tap:wave_1' },
      },
      { emotion: 'happy', action: 'wave', text: '<color=red>你好</color>' },
      () => 7,
    );

    expect(messages).toEqual([
      {
        msg: 11000,
        msgId: 7,
        data: {
          id: 2,
          text: '＜color=red＞你好＜/color＞',
          choices: [],
          textFrameColor: 0x000000,
          textColor: 0xffffff,
          duration: 6_000,
        },
      },
      { msg: 13300, msgId: 7, data: { id: 2, expId: 4 } },
      { msg: 13200, msgId: 7, data: { id: 2, type: 0, mtn: 'tap:wave_1' } },
    ]);
    expect(JSON.stringify(messages)).not.toMatch(/[A-Z]:\\|\.motion3\.json/);
  });

  it('maps presentation state only through configured safe motion groups', () => {
    expect(
      buildViewerExPresentationMessages(
        {
          ...DEFAULT_VIEWEREX_SETTINGS,
          enabled: true,
          stateMotions: { thinking: 'idle:think' },
        },
        { state: 'thinking' },
        () => 12,
      ),
    ).toEqual([{ msg: 13200, msgId: 12, data: { id: 0, type: 0, mtn: 'idle:think' } }]);
  });

  it('does nothing for unconfigured emotion and action mappings', () => {
    expect(
      buildViewerExPresentationMessages(
        { ...DEFAULT_VIEWEREX_SETTINGS, enabled: true, bubbleEnabled: false },
        { emotion: 'sad', action: 'unknown' },
        () => 1,
      ),
    ).toEqual([]);
  });
});
