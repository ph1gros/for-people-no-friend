import {
  validateExtensionCapabilityManifest,
  type ExtensionCapabilityManifest,
} from '../core/desktop/integration';

export const MAX_DESKTOP_WIDGETS = 32;
export const isWidgetId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[A-Za-z0-9_-]{1,64}$/u.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value);

export const WIDGET_SOURCE_PERMISSIONS = Object.freeze({
  'input.keys': 'input-activity',
  'input.mouse': 'input-activity',
  'input.direction': 'input-activity',
  'media.title': 'media-control',
  'media.artist': 'media-control',
  'media.playing': 'media-control',
  'media.player': 'media-control',
  'clock.time': 'clock',
  'clock.date': 'clock',
  'clock.timezone': 'clock',
  'system.cpu': 'system-load',
  'system.memory': 'system-load',
} as const);
export type WidgetSource = keyof typeof WIDGET_SOURCE_PERMISSIONS;
export type WidgetValue = string | number | boolean | string[] | null;
export const WIDGET_FORMATS = [
  'HH:mm',
  'HH:mm:ss',
  'M月d日 EEE',
  'percent',
  'bytes',
  'raw',
] as const;
export type WidgetFormat = (typeof WIDGET_FORMATS)[number];
export type WidgetRow =
  | { kind: 'value'; source: WidgetSource; format: WidgetFormat }
  | { kind: 'label'; source?: WidgetSource; format?: WidgetFormat; text?: string }
  | { kind: 'bar'; source: WidgetSource; min: number; max: number }
  | { kind: 'icons'; source: 'input.keys' | 'input.mouse' };
export interface WidgetManifest {
  capability: ExtensionCapabilityManifest;
  title: string;
  description: string;
  iconText: string;
  layout: { rows: WidgetRow[] };
  cardState: {
    enabledFrom: 'widget.enabled';
    activeFrom: 'widget.available';
    labels: { active: string; inactive: string; disabled: string };
  };
}
export interface WidgetSnapshot {
  manifest: WidgetManifest;
  enabled: boolean;
  available: boolean;
  values: Partial<Record<WidgetSource, WidgetValue>>;
  error?: string;
}

export class WidgetPackageError extends Error {
  public constructor(
    public readonly rule: number,
    public readonly file: string,
    reason: string,
  ) {
    super(`小组件包规则 ${rule}（${file}）：${reason}`);
    this.name = 'WidgetPackageError';
  }
}
export const widgetFail = (rule: number, file: string, reason: string): never => {
  throw new WidgetPackageError(rule, file, reason);
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= max &&
  ![...value].some(
    (character) => character.charCodeAt(0) < 32 && ![9, 10, 13].includes(character.charCodeAt(0)),
  );
const keys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));

export const parseWidgetManifest = (value: unknown): WidgetManifest => {
  const file = 'manifest.json';
  if (
    !object(value) ||
    !keys(value, ['capability', 'title', 'description', 'iconText', 'layout', 'cardState'])
  )
    return widgetFail(3, file, '清单结构无效');
  let capability: ExtensionCapabilityManifest;
  try {
    capability = validateExtensionCapabilityManifest(value.capability);
  } catch {
    return widgetFail(3, file, '能力清单无效');
  }
  if (capability.kind !== 'widget' || !isWidgetId(capability.id))
    return widgetFail(3, file, '必须是有效的小组件');
  if (
    capability.permissions.some(
      (permission) =>
        !Object.values(WIDGET_SOURCE_PERMISSIONS).some((known) => known === permission),
    )
  )
    return widgetFail(5, file, '声明了未实现的权限');
  if (!text(value.title, 32) || !text(value.description, 120) || !text(value.iconText, 4))
    return widgetFail(8, file, '名称、说明或图标文字超限');
  const card = value.cardState;
  if (
    !object(card) ||
    !keys(card, ['enabledFrom', 'activeFrom', 'labels']) ||
    card.enabledFrom !== 'widget.enabled' ||
    card.activeFrom !== 'widget.available' ||
    !object(card.labels) ||
    !keys(card.labels, ['active', 'inactive', 'disabled']) ||
    !text(card.labels.active, 8) ||
    !text(card.labels.inactive, 8) ||
    !text(card.labels.disabled, 8)
  )
    return widgetFail(8, file, '卡片须绑定本组件状态并提供三个短标签');
  if (
    !object(value.layout) ||
    !keys(value.layout, ['rows']) ||
    !Array.isArray(value.layout.rows) ||
    value.layout.rows.length < 1 ||
    value.layout.rows.length > 6
  )
    return widgetFail(6, file, '仅允许 1 至 6 行');
  const rows = value.layout.rows.map((row): WidgetRow => {
    if (!object(row)) return widgetFail(6, file, '行结构无效');
    const source = row.source;
    if (
      source !== undefined &&
      (typeof source !== 'string' || !Object.hasOwn(WIDGET_SOURCE_PERMISSIONS, source))
    )
      return widgetFail(5, file, '未知数据源');
    const checkedSource = source as WidgetSource | undefined;
    if (checkedSource && !capability.permissions.includes(WIDGET_SOURCE_PERMISSIONS[checkedSource]))
      return widgetFail(5, file, '数据源缺少权限声明');
    if (
      row.kind === 'bar' &&
      keys(row, ['kind', 'source', 'min', 'max']) &&
      checkedSource &&
      typeof row.min === 'number' &&
      Number.isFinite(row.min) &&
      typeof row.max === 'number' &&
      Number.isFinite(row.max) &&
      row.min < row.max
    )
      return { kind: 'bar', source: checkedSource, min: row.min, max: row.max };
    if (
      row.kind === 'icons' &&
      keys(row, ['kind', 'source']) &&
      (checkedSource === 'input.keys' || checkedSource === 'input.mouse')
    )
      return { kind: 'icons', source: checkedSource };
    if (
      (row.kind === 'value' || row.kind === 'label') &&
      keys(
        row,
        row.kind === 'value' ? ['kind', 'source', 'format'] : ['kind', 'source', 'format', 'text'],
      )
    ) {
      if (row.format !== undefined && !WIDGET_FORMATS.includes(row.format as WidgetFormat))
        return widgetFail(6, file, '未知显示格式');
      if (row.kind === 'value' && checkedSource && row.format !== undefined)
        return { kind: 'value', source: checkedSource, format: row.format as WidgetFormat };
      if (
        row.kind === 'label' &&
        (checkedSource || text(row.text, 120)) &&
        (row.text === undefined || text(row.text, 120))
      )
        return {
          kind: 'label',
          ...(checkedSource ? { source: checkedSource } : {}),
          ...(row.format ? { format: row.format as WidgetFormat } : {}),
          ...(typeof row.text === 'string' ? { text: row.text } : {}),
        };
    }
    return widgetFail(6, file, '行类型或字段无效');
  });
  return {
    capability,
    title: value.title,
    description: value.description,
    iconText: value.iconText,
    layout: { rows },
    cardState: {
      enabledFrom: 'widget.enabled',
      activeFrom: 'widget.available',
      labels: {
        active: card.labels.active,
        inactive: card.labels.inactive,
        disabled: card.labels.disabled,
      },
    },
  };
};
