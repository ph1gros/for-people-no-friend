import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { inspectWidgetPackage } from '../src/main/widgets/widget-package-loader';

export const clockManifest = () => ({
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
const archive = (manifest: unknown = clockManifest(), files: Record<string, Uint8Array> = {}) =>
  zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), ...files });

describe('declarative widget packages', () => {
  it('loads a clock manifest as data', () => {
    expect(inspectWidgetPackage(archive(), 'clock.zip', []).manifest.title).toBe('时钟');
  });
  it.each([
    ['renamed PE', 1, { 'payload.json': new Uint8Array([77, 90, 0, 0]) }],
    ['script', 1, { 'evil.js': strToU8('alert(1)') }],
    ['traversal', 2, { '../../../evil.txt': strToU8('x') }],
    ['SVG script', 7, { 'icon.svg': strToU8('<svg><script>alert(1)</script></svg>') }],
    ['SVG event', 7, { 'icon.svg': strToU8('<svg onload="evil()"></svg>') }],
    ['SVG reference', 7, { 'icon.svg': strToU8('<svg><use href="https://evil"/></svg>') }],
    [
      'translation',
      8,
      { 'strings/en-US.json': strToU8(JSON.stringify({ title: 'x'.repeat(33) })) },
    ],
  ] as const)('rejects %s with a visible rule and file', (_label, rule, files) => {
    expect(() => inspectWidgetPackage(archive(clockManifest(), files), 'clock.zip', [])).toThrow(
      expect.objectContaining({
        rule,
        file: expect.any(String),
        message: expect.stringContaining(`规则 ${rule}`),
      }),
    );
  });
  it.each([
    ['timeout', 3, { capability: { ...clockManifest().capability, timeoutMs: 50 } }],
    ['provider', 3, { capability: { ...clockManifest().capability, kind: 'provider' } }],
    ['network', 5, { capability: { ...clockManifest().capability, permissions: ['network'] } }],
    [
      'undeclared source',
      5,
      { layout: { rows: [{ kind: 'value', source: 'system.cpu', format: 'percent' }] } },
    ],
    ['too many rows', 6, { layout: { rows: Array(7).fill(clockManifest().layout.rows[0]) } }],
    ['HTML', 6, { layout: { rows: [{ kind: 'html' }] } }],
    [
      'expression format',
      6,
      { layout: { rows: [{ kind: 'value', source: 'clock.time', format: '{{x}}' }] } },
    ],
    ['title', 8, { title: 'x'.repeat(33) }],
  ])('rejects invalid %s', (_label, rule, changes) => {
    expect(() =>
      inspectWidgetPackage(archive({ ...clockManifest(), ...changes }), 'clock.zip', []),
    ).toThrow(expect.objectContaining({ rule }));
  });
  it('rejects duplicate IDs and mismatched package names', () => {
    expect(() => inspectWidgetPackage(archive(), 'other.zip', [])).toThrow(
      expect.objectContaining({ rule: 4 }),
    );
    expect(() => inspectWidgetPackage(archive(), 'clock.zip', ['clock'])).toThrow(
      expect.objectContaining({ rule: 4 }),
    );
  });
  it('rejects symbolic links even when their name is allowed', () => {
    const bytes = archive();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < bytes.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 38, 0xa1ff0000, true);
        break;
      }
    }
    expect(() => inspectWidgetPackage(bytes, 'clock.zip', [])).toThrow(
      expect.objectContaining({ rule: 2 }),
    );
  });
  it('rejects oversized decompression and duplicate archive entries', () => {
    expect(() =>
      inspectWidgetPackage(
        archive(clockManifest(), { 'icon.svg': new Uint8Array(1024 * 1024) }),
        'clock.zip',
        [],
      ),
    ).toThrow(expect.objectContaining({ rule: 2 }));
  });
});
