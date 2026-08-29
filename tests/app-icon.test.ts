import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('application icon assets', () => {
  it('sets the Windows shell identity before the application becomes ready', () => {
    const mainSource = readFileSync(resolve('src/main/index.ts'), 'utf8');

    expect(mainSource).toContain("const PRODUCT_NAME = 'For People No Friend';");
    expect(mainSource).toContain(
      "const WINDOWS_APP_USER_MODEL_ID = 'com.ph1gros.forpeoplenofriend';",
    );
    expect(mainSource).toContain('app.setName(PRODUCT_NAME);');
    expect(mainSource).toContain('app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)');
  });

  it('keeps the supplied source and provides a square runtime PNG', () => {
    const source = readFileSync(resolve('build/icon-source.jpg'));
    const png = readFileSync(resolve('build/icon.png'));

    expect([...source.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(512);
    expect(png.readUInt32BE(20)).toBe(512);
  });

  it('provides the standard Windows icon sizes', () => {
    const ico = readFileSync(resolve('build/icon.ico'));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, index) => {
      const width = ico[6 + index * 16];
      return width === 0 ? 256 : width;
    });

    expect(sizes).toContain(16);
    expect(sizes).toContain(32);
    expect(sizes).toContain(48);
    expect(sizes).toContain(128);
    expect(sizes).toContain(256);
  });
});
