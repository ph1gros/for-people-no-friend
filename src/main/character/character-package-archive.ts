import { createHash } from 'node:crypto';

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import {
  validateCharacterPackageManifest,
  type CharacterPackageManifest,
} from '../../core/character/character-package';

export const MAX_CHARACTER_PACKAGE_BYTES = 256 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 2_001;
const MANIFEST_PATH = 'manifest.json';
const EXECUTABLE_EXTENSION = /\.(?:bat|cmd|com|cpl|dll|exe|hta|js|lnk|mjs|msi|node|ps1|scr|vbs)$/iu;

export interface InspectedCharacterPackage {
  manifest: CharacterPackageManifest;
  files: ReadonlyMap<string, Uint8Array>;
}

const fail = (): never => {
  throw new Error('The character package archive is invalid or unsafe.');
};

const decodeArchiveName = (decoder: TextDecoder, bytes: Uint8Array): string => {
  try {
    return decoder.decode(bytes);
  } catch {
    return fail();
  }
};

const unzipArchive = (bytes: Uint8Array): Record<string, Uint8Array> => {
  try {
    return unzipSync(bytes);
  } catch {
    return fail();
  }
};

const parseManifest = (bytes: Uint8Array): CharacterPackageManifest => {
  try {
    return validateCharacterPackageManifest(JSON.parse(strFromU8(bytes)) as unknown);
  } catch {
    return fail();
  }
};

const isSafeArchivePath = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 240 &&
  !value.includes('\\') &&
  !value.startsWith('/') &&
  !value.endsWith('/') &&
  !value.split('/').includes('..') &&
  !/^[a-z][a-z\d+.-]*:/iu.test(value) &&
  !EXECUTABLE_EXTENSION.test(value);

const inspectCentralDirectory = (bytes: Uint8Array): string[] => {
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_CHARACTER_PACKAGE_BYTES) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  const searchStart = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= searchStart; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) fail();
  const disk = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const diskEntries = view.getUint16(endOffset + 8, true);
  const entries = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== entries ||
    entries < 1 ||
    entries > MAX_ARCHIVE_ENTRIES ||
    entries === 0xffff ||
    centralOffset + centralSize > endOffset
  ) {
    fail();
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const names: string[] = [];
  let totalBytes = 0;
  let offset = centralOffset;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > endOffset || view.getUint32(offset, true) !== 0x02014b50) fail();
    const flags = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (
      (flags & 0x1) !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      uncompressedSize > MAX_ENTRY_BYTES ||
      nameLength < 1 ||
      offset + 46 + nameLength + extraLength + commentLength > endOffset
    ) {
      fail();
    }
    const name = decodeArchiveName(decoder, bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!isSafeArchivePath(name) || names.includes(name)) fail();
    names.push(name);
    totalBytes += uncompressedSize;
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) fail();
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize || !names.includes(MANIFEST_PATH)) fail();
  return names;
};

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export const inspectCharacterPackageArchive = (bytes: Uint8Array): InspectedCharacterPackage => {
  const centralNames = inspectCentralDirectory(bytes);
  const archive = unzipArchive(bytes);
  if (Object.keys(archive).length !== centralNames.length) fail();
  const manifest = parseManifest(archive[MANIFEST_PATH]!);
  const expectedPaths = new Set(manifest.assets.map(({ path }) => path));
  const actualPaths = centralNames.filter((name) => name !== MANIFEST_PATH);
  if (
    actualPaths.length !== expectedPaths.size ||
    actualPaths.some((name) => !expectedPaths.has(name))
  ) {
    fail();
  }
  for (const asset of manifest.assets) {
    const content = archive[asset.path];
    if (!content || sha256(content) !== asset.sha256) fail();
  }
  return {
    manifest,
    files: new Map(actualPaths.map((name) => [name, archive[name]!])),
  };
};

export const createCharacterPackageArchive = (
  manifest: CharacterPackageManifest,
  files: ReadonlyMap<string, Uint8Array>,
): Uint8Array => {
  const validated = validateCharacterPackageManifest(manifest);
  if (
    files.size !== validated.assets.length ||
    validated.assets.some(({ path, sha256: digest }) => {
      const content = files.get(path);
      return !content || !isSafeArchivePath(path) || sha256(content) !== digest;
    })
  ) {
    fail();
  }
  const entries: Record<string, Uint8Array> = {
    [MANIFEST_PATH]: strToU8(`${JSON.stringify(validated, null, 2)}\n`),
  };
  let totalBytes = entries[MANIFEST_PATH].byteLength;
  for (const [name, content] of files) {
    totalBytes += content.byteLength;
    if (content.byteLength > MAX_ENTRY_BYTES || totalBytes > MAX_UNCOMPRESSED_BYTES) fail();
    entries[name] = content;
  }
  const archive = zipSync(entries, { level: 6 });
  if (archive.byteLength > MAX_CHARACTER_PACKAGE_BYTES) fail();
  return archive;
};
