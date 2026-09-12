import type {
  WidgetFormat,
  WidgetRow,
  WidgetSnapshot,
  WidgetValue,
} from '../../shared/widget-contract';

export const formatWidgetValue = (value: WidgetValue | undefined, format: WidgetFormat): string => {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'number' && !Number.isFinite(value))
  )
    return '—';
  if (format === 'raw')
    return (Array.isArray(value) ? value.join(' ') : String(value)).slice(0, 256);
  if (typeof value !== 'number') return '—';
  if (format === 'percent') return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
  if (format === 'bytes') {
    if (!Number.isSafeInteger(value) || value < 0) return '—';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index++;
    }
    return `${index === 0 ? value : value.toFixed(1)} ${units[index]}`;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  if (format === 'HH:mm') return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (format === 'HH:mm:ss')
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 周${'日一二三四五六'[date.getDay()]}`;
};

export const renderWidgetRow = (
  row: WidgetRow,
  snapshot: WidgetSnapshot,
  document: Document,
): HTMLElement => {
  const element = document.createElement('div');
  element.className = `declarative-widget__${row.kind}`;
  const value = row.source ? snapshot.values[row.source] : undefined;
  if (row.kind === 'bar') {
    const valid = typeof value === 'number' && Number.isFinite(value);
    const progress = document.createElement('progress');
    progress.max = 1;
    progress.value = valid ? Math.max(0, Math.min(1, (value - row.min) / (row.max - row.min))) : 0;
    progress.setAttribute('aria-label', snapshot.manifest.title);
    element.append(progress);
    if (!valid) element.append(document.createTextNode('—'));
  } else if (row.kind === 'icons') {
    element.textContent = Array.isArray(value) ? value.slice(0, 24).join(' ').slice(0, 256) : '—';
  } else {
    element.textContent =
      row.kind === 'label' && row.text ? row.text : formatWidgetValue(value, row.format ?? 'raw');
  }
  return element;
};

export const renderWidgetSnapshot = (container: HTMLElement, snapshot: WidgetSnapshot): void => {
  container.hidden = !snapshot.enabled;
  container.setAttribute('aria-label', snapshot.manifest.title);
  container.replaceChildren(
    ...snapshot.manifest.layout.rows.map((row) =>
      renderWidgetRow(row, snapshot, container.ownerDocument),
    ),
  );
  if (snapshot.error) {
    const error = container.ownerDocument.createElement('span');
    error.textContent = snapshot.error;
    container.append(error);
  }
};
