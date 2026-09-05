import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve('src/renderer/styles.css'), 'utf8');

/** Variables the renderer sets at runtime rather than declaring in the stylesheet. */
const RUNTIME_VARIABLES = new Set([
  '--visible-frame-top',
  '--visible-frame-height',
  '--visible-frame-left',
  '--visible-frame-width',
  '--desktop-widget-reserve',
]);

const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

/** sRGB → HSL 色相，只用来判断“这是不是同一族颜色”，不参与任何取色。 */
const hue = (literal: string): { hue: number; saturation: number } | undefined => {
  let rgb: number[] | undefined;
  const hex = /^#([0-9a-fA-F]{3,8})$/.exec(literal.trim());
  if (hex) {
    const digits = hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    if (digits.length < 6) return undefined;
    rgb = [0, 2, 4].map((index) => Number.parseInt(digits.slice(index, index + 2), 16));
  } else {
    const inner = /^rgba?\(([^)]*)\)$/.exec(literal.trim());
    if (!inner) return undefined;
    const parts = inner[1]
      .split(/[,\s/]+/)
      .filter(Boolean)
      .slice(0, 3);
    if (parts.length < 3) return undefined;
    rgb = parts.map((part) => (part.endsWith('%') ? Number.parseFloat(part) * 2.55 : Number(part)));
  }
  if (rgb.some((channel) => !Number.isFinite(channel))) return undefined;
  const [r, g, b] = rgb.map((channel) => channel / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  const lightness = (max + min) / 2;
  if (span === 0) return { hue: 0, saturation: 0 };
  const saturation = span / (1 - Math.abs(2 * lightness - 1));
  const raw =
    max === r
      ? (g - b) / span + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / span + 2
        : (r - g) / span + 4;
  return { hue: raw * 60, saturation };
};

const tokenBlock = (): string => {
  const match = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  expect(match, ':root 中的 token 块应当存在').toBeTruthy();
  return match![1];
};

const declaredTokens = (): Map<string, string> => {
  const tokens = new Map<string, string>();
  for (const line of tokenBlock().split('\n')) {
    const match = /^\s*(--[\w-]+)\s*:\s*(.+?);/.exec(line);
    if (match) tokens.set(match[1], match[2].trim());
  }
  return tokens;
};

/** Everything after the token block — the actual rules. */
const rules = (): string => {
  const match = /:root\s*\{[\s\S]*?\n\}\n?/.exec(css);
  return match ? css.slice(match.index + match[0].length) : css;
};

describe('renderer design tokens', () => {
  it('defines every token the rules reference', () => {
    const declared = declaredTokens();
    const missing = new Set<string>();
    for (const [, name] of rules().matchAll(/var\((--[\w-]+)\)/g)) {
      if (!declared.has(name) && !RUNTIME_VARIABLES.has(name)) missing.add(name);
    }
    expect([...missing]).toEqual([]);
  });

  it('declares each token exactly once', () => {
    const names = [...tokenBlock().matchAll(/^\s*(--[\w-]+)\s*:/gm)].map(([, name]) => name);
    const duplicated = names.filter((name, index) => names.indexOf(name) !== index);
    expect([...new Set(duplicated)]).toEqual([]);
  });

  it('gives every token a parseable colour or numeric value', () => {
    for (const [name, value] of declaredTokens()) {
      expect(value, `${name} 的值应当可解析`).toMatch(
        /^(#[0-9a-fA-F]{3,8}|rgba?\(.+\)|[\d.]+(px|rem|em|%|s|ms)?)$/,
      );
    }
  });

  it('never repeats the same colour literal outside the token block', () => {
    // 这条是防回归的核心：一个颜色值被写第二遍，说明它该成为 token 却没有。
    // 这套样式表原本有 229 种写法表达约 190 种意图——同一个面板底色曾有 11 种写法。
    const counts = new Map<string, number>();
    for (const [literal] of rules().matchAll(COLOUR)) {
      const key = literal.replaceAll(/\s+/g, ' ').toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const repeated = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([literal, count]) => `${literal} ×${count}`);
    expect(repeated).toEqual([]);
  });

  it('keeps every purple on one hue', () => {
    // 第二步（换配色）把所有紫色统一到了同一个色相。这条守住它：
    // 以后再往样式表里粘一个色相不同的紫，会在这里被拦下，而不是等到界面上看出来花。
    const strays: string[] = [];
    for (const [literal] of css.matchAll(COLOUR)) {
      const measured = hue(literal);
      if (!measured || measured.saturation <= 0.1) continue;
      if (measured.hue < 240 || measured.hue > 330) continue; // 只管紫色一族
      if (measured.hue < 245 || measured.hue > 270)
        strays.push(`${literal} → ${measured.hue.toFixed(1)}°`);
    }
    expect(strays).toEqual([]);
  });

  it('keeps the purple identity as its own named group', () => {
    // 紫色是产品的识别色。把它单独命名，换配色时才能一次改完而不用逐条搜索。
    const declared = [...declaredTokens().keys()];
    expect(declared.filter((name) => name.startsWith('--accent-')).length).toBeGreaterThan(0);
    expect(declared.filter((name) => name.startsWith('--fill-')).length).toBeGreaterThan(0);
  });
});
