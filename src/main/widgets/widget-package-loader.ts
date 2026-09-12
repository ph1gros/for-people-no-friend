import path from 'node:path';
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
import {
  parseWidgetManifest,
  widgetFail,
  WidgetPackageError,
  type WidgetManifest,
} from '../../shared/widget-contract';

export const MAX_WIDGET_PACKAGE_BYTES = 1024 * 1024;
const ALLOWED_FILES = new Set([
  'manifest.json',
  'icon.svg',
  'strings/zh-CN.json',
  'strings/en-US.json',
]);
const EXECUTABLE = /\.(?:js|mjs|cjs|wasm|dll|exe|py|sh|bat|ps1|cmd|com|vbs|hta|lnk|node|msi)$/iu;
const decoder = new TextDecoder('utf-8', { fatal: true });

const safeName = (name: string): string => {
  const normalized = path.posix.normalize(name.replaceAll('\\', '/'));
  if (
    !name ||
    name !== normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').includes('..') ||
    name.includes(':') ||
    [...name].some((character) => character.charCodeAt(0) < 32)
  )
    return widgetFail(2, 'archive.zip', '文件路径不安全');
  if (EXECUTABLE.test(normalized)) return widgetFail(1, normalized, '禁止可执行文件');
  return normalized;
};

// Inspect metadata before inflation, including Unix links and duplicate names.
const inspectDirectory = (bytes: Uint8Array): Map<string, number> => {
  if (bytes.length < 22 || bytes.length > MAX_WIDGET_PACKAGE_BYTES)
    return widgetFail(2, 'archive.zip', '归档体积无效');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0 || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0)
    return widgetFail(2, 'archive.zip', '不支持多卷或损坏归档');
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const directoryEnd = cursor + view.getUint32(end + 12, true);
  if (count < 1 || count > 32 || count !== view.getUint16(end + 8, true) || directoryEnd !== end)
    return widgetFail(2, 'archive.zip', '条目数量或目录无效');
  const names = new Map<string, number>();
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50)
      return widgetFail(2, 'archive.zip', '损坏的目录');
    const length = view.getUint16(cursor + 28, true);
    const next =
      cursor + 46 + length + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    if (next > end || length < 1) return widgetFail(2, 'archive.zip', '文件名无效');
    const name = safeName(decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + length)));
    const mode = view.getUint32(cursor + 38, true) >>> 16;
    if (
      (mode & 0xf000) === 0xa000 ||
      (mode & 0xf000) === 0x4000 ||
      (view.getUint16(cursor + 8, true) & 1) !== 0 ||
      names.has(name)
    )
      return widgetFail(2, name, '禁止链接、目录、加密或重复条目');
    const size = view.getUint32(cursor + 24, true);
    total += size;
    if (total > MAX_WIDGET_PACKAGE_BYTES) return widgetFail(2, name, '解压体积超限');
    names.set(name, size);
    cursor = next;
  }
  if (cursor !== directoryEnd || !names.has('manifest.json'))
    return widgetFail(3, 'manifest.json', '缺少清单');
  return names;
};

export interface InspectedWidgetPackage {
  manifest: WidgetManifest;
  files: ReadonlyMap<string, Uint8Array>;
}

const inspectPackage = (
  bytes: Uint8Array,
  packageName: string,
  registeredIds: readonly string[],
): InspectedWidgetPackage => {
  const names = inspectDirectory(bytes);
  const files = new Map<string, Uint8Array>();
  let error: unknown;
  let total = 0;
  const unzip = new Unzip((file) => {
    const name = safeName(file.name);
    if (!names.has(name) || files.has(name)) return widgetFail(2, name, '本地条目与目录不一致');
    const chunks: Uint8Array[] = [];
    let size = 0;
    files.set(name, new Uint8Array());
    file.ondata = (failure, chunk, final) => {
      if (failure) {
        error = failure;
        return;
      }
      size += chunk.length;
      total += chunk.length;
      if (total > MAX_WIDGET_PACKAGE_BYTES || size > names.get(name)!) {
        file.terminate();
        return widgetFail(2, name, '实际解压体积超限');
      }
      chunks.push(chunk);
      if (final) {
        if (size !== names.get(name)) return widgetFail(2, name, '解压体积不符');
        const result = new Uint8Array(size);
        let offset = 0;
        for (const part of chunks) {
          result.set(part, offset);
          offset += part.length;
        }
        files.set(name, result);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  unzip.push(bytes, true);
  if (error || files.size !== names.size) return widgetFail(2, 'archive.zip', '解压失败');
  for (const [name, content] of files) {
    const prefix = [...content.subarray(0, 4)].join(',');
    if (
      (content[0] === 77 && content[1] === 90) ||
      prefix === '127,69,76,70' ||
      prefix === '0,97,115,109'
    )
      return widgetFail(1, name, '禁止可执行文件签名');
    if (!ALLOWED_FILES.has(name)) return widgetFail(2, name, '包内仅允许清单、图标和指定语言文件');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(files.get('manifest.json')!));
  } catch {
    return widgetFail(3, 'manifest.json', '无效 JSON');
  }
  const manifest = parseWidgetManifest(raw);
  if (
    packageName !== `${manifest.capability.id}.zip` ||
    registeredIds.includes(manifest.capability.id)
  )
    return widgetFail(4, 'manifest.json', '包名不符或 ID 已注册');
  for (const [name, content] of files) {
    if (name === 'icon.svg') {
      const svg = decoder.decode(content);
      // Deliberately accept a small inert SVG subset; no entities, URLs, CSS or active elements.
      if (
        !/^\s*<svg[\s>]/u.test(svg) ||
        /<!|<\?|&|\b(?:href|style|on[a-z]+)\s*=|url\s*\(|<\s*\/?\s*(?!(?:svg|g|path|circle|rect|line|polyline|polygon|ellipse|title|desc)\b)[a-z]/iu.test(
          svg,
        )
      )
        return widgetFail(7, name, 'SVG 仅允许静态几何图形，禁止脚本、引用和事件');
    }
    if (name.startsWith('strings/')) {
      let strings: unknown;
      try {
        strings = JSON.parse(decoder.decode(content));
      } catch {
        return widgetFail(8, name, '无效文案 JSON');
      }
      if (!strings || typeof strings !== 'object' || Array.isArray(strings))
        return widgetFail(8, name, '文案必须是对象');
      const limits: Record<string, number> = {
        title: 32,
        description: 120,
        iconText: 4,
        active: 8,
        inactive: 8,
        disabled: 8,
      };
      for (const [key, value] of Object.entries(strings)) {
        if (
          !Object.hasOwn(limits, key) ||
          typeof value !== 'string' ||
          value.trim().length === 0 ||
          value.length > limits[key]!
        )
          return widgetFail(8, name, '文案字段或长度无效');
      }
    }
  }
  return { manifest, files };
};

export const inspectWidgetPackage = (
  bytes: Uint8Array,
  packageName: string,
  registeredIds: readonly string[],
): InspectedWidgetPackage => {
  try {
    return inspectPackage(bytes, packageName, registeredIds);
  } catch (error) {
    if (error instanceof WidgetPackageError) throw error;
    return widgetFail(2, 'archive.zip', '归档格式、编码或压缩数据无效');
  }
};
