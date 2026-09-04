const MAX_WIDGET_VIEWPORT_RATIO = 0.45;

export const calculateDesktopWidgetReserve = (
  measuredHeight: number,
  viewportHeight: number,
): number => {
  if (
    !Number.isFinite(measuredHeight) ||
    !Number.isFinite(viewportHeight) ||
    measuredHeight <= 0 ||
    viewportHeight <= 0
  ) {
    return 0;
  }
  return Math.min(
    Math.ceil(measuredHeight),
    Math.floor(viewportHeight * MAX_WIDGET_VIEWPORT_RATIO),
  );
};
