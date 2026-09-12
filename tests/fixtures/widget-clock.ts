import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { parseWidgetManifest } from '../../src/shared/widget-contract';

export const manifest = parseWidgetManifest({
  capability: { version: 1, id: 'clock', kind: 'widget', permissions: ['clock'], timeoutMs: 1000 },
  title: '时钟',
  description: '显示本机时间',
  iconText: '🕐',
  layout: { rows: [{ kind: 'value', source: 'clock.time', format: 'HH:mm' }] },
  cardState: {
    enabledFrom: 'widget.enabled',
    activeFrom: 'widget.available',
    labels: { active: '运行中', inactive: '不可用', disabled: '已关闭' },
  },
});
const content = strToU8(JSON.stringify(manifest));
export const bytes = zipSync({ 'manifest.json': content }, { mtime: new Date(2020, 0, 1) });
export const integrity = Object.freeze({
  version: '1.0.0',
  target: 'clock',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  compressedBytes: bytes.length,
  extractedBytes: content.length,
  maxEntries: 1,
});
