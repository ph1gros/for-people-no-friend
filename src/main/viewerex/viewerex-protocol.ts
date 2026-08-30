import type { ViewerExPresentationInput, ViewerExSettings } from '../../shared/viewerex-ipc';

const MAX_BUBBLE_CODE_POINTS = 1_000;

export interface ViewerExMessage {
  msg: 11000 | 13200 | 13300;
  msgId: number;
  data: unknown;
}

export const sanitizeViewerExBubbleText = (value: string): string =>
  [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint === 9 ||
        codePoint === 10 ||
        codePoint === 13 ||
        (codePoint >= 32 && codePoint !== 127)
      );
    })
    .map((character) => (character === '<' ? '＜' : character === '>' ? '＞' : character))
    .slice(0, MAX_BUBBLE_CODE_POINTS)
    .join('');

export const buildViewerExPresentationMessages = (
  settings: ViewerExSettings,
  input: ViewerExPresentationInput,
  nextMessageId: () => number,
): ViewerExMessage[] => {
  const messages: ViewerExMessage[] = [];
  if (settings.bubbleEnabled && input.text) {
    const text = sanitizeViewerExBubbleText(input.text);
    if (text) {
      messages.push({
        msg: 11000,
        msgId: nextMessageId(),
        data: {
          id: settings.modelIndex,
          text,
          choices: [],
          textFrameColor: 0x000000,
          textColor: 0xffffff,
          duration: settings.bubbleDurationMs,
        },
      });
    }
  }

  const expressionId = input.emotion ? settings.emotionExpressions[input.emotion] : undefined;
  if (expressionId !== undefined) {
    messages.push({
      msg: 13300,
      msgId: nextMessageId(),
      data: { id: settings.modelIndex, expId: expressionId },
    });
  }

  const stateMotion = input.state ? settings.stateMotions[input.state] : undefined;
  if (stateMotion) {
    messages.push({
      msg: 13200,
      msgId: nextMessageId(),
      data: { id: settings.modelIndex, type: 0, mtn: stateMotion },
    });
  }

  const motion = input.action ? settings.actionMotions[input.action] : undefined;
  if (motion) {
    messages.push({
      msg: 13200,
      msgId: nextMessageId(),
      data: { id: settings.modelIndex, type: 0, mtn: motion },
    });
  }
  return messages;
};
