#!/usr/bin/env node
/**
 * Prove that a token extraction changed no rendered colour.
 *
 * Every colour literal in the "before" stylesheet is matched against the same position in the
 * "after" one, with `var(--token)` expanded back to its definition. Semi-transparent values are
 * composited onto a representative dark ground first, because that is what the eye actually sees,
 * then compared in CIE Lab. A pair is accepted when ΔE < 1.0 — the threshold below which the
 * difference is not perceptible even in side-by-side comparison.
 *
 *   node scripts/verify-style-tokens.mjs <before.css> <after.css> [--max <ΔE>]
 *
 * `--max` raises the ceiling for a change that is *meant* to be visible, such as a palette
 * revision. It does not turn the check off: every site is still measured, and the run fails if
 * any one of them moves further than the budget you declared.
 *
 * To check an uncommitted change against the last commit:
 *   git show HEAD:src/renderer/styles.css > /tmp/before.css
 *   node scripts/verify-style-tokens.mjs /tmp/before.css src/renderer/styles.css
 */
import { readFileSync } from 'node:fs';
import console from 'node:console';
import process from 'node:process';

const DEFAULT_THRESHOLD = 1.0;
/** The chat shell renders over a dark ground; alpha must be resolved against it to compare. */
const GROUND = [26, 28, 32];
const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

const parseColour = (raw) => {
  const value = raw.trim();
  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    if (hex.length !== 6 && hex.length !== 8) return undefined;
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    ];
  }
  const inner = /rgba?\(([^)]*)\)/.exec(value);
  if (!inner) return undefined;
  const parts = inner[1].split(/[,\s/]+/).filter(Boolean);
  if (parts.length < 3) return undefined;
  const channel = (p) =>
    p.endsWith('%') ? (Number.parseFloat(p) * 255) / 100 : Number.parseFloat(p);
  const alpha =
    parts[3] === undefined
      ? 1
      : parts[3].endsWith('%')
        ? Number.parseFloat(parts[3]) / 100
        : Number.parseFloat(parts[3]);
  const rgb = parts.slice(0, 3).map(channel);
  return rgb.some(Number.isNaN) || Number.isNaN(alpha) ? undefined : [...rgb, alpha];
};

const toLab = ([r, g, b, a]) => {
  const composite = [r, g, b].map((c, i) => c * a + GROUND[i] * (1 - a));
  const linear = composite.map((c) => {
    const u = c / 255;
    return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
  });
  const [lr, lg, lb] = linear;
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
  const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const readDefinitions = (css) => {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  const definitions = new Map();
  if (!root) return definitions;
  for (const line of root[1].split('\n')) {
    const match = /^\s*(--[\w-]+)\s*:\s*(.+?);/.exec(line);
    if (match) definitions.set(match[1], match[2].trim());
  }
  return definitions;
};

/** Strip the token block, then expand only tokens this file defines. */
const flattenRules = (css) => {
  const definitions = readDefinitions(css);
  const root = /:root\s*\{[\s\S]*?\n\}\n?/.exec(css);
  const rules = root ? css.slice(root.index + root[0].length) : css;
  return rules.replace(/var\((--[\w-]+)\)/g, (whole, name) => definitions.get(name) ?? whole);
};

const argv = process.argv.slice(2);
const maxIndex = argv.indexOf('--max');
const THRESHOLD = maxIndex === -1 ? DEFAULT_THRESHOLD : Number(argv[maxIndex + 1]);
const [beforePath, afterPath] = argv.filter(
  (arg, index) => maxIndex === -1 || (index !== maxIndex && index !== maxIndex + 1),
);
if (!beforePath || !afterPath || !Number.isFinite(THRESHOLD) || THRESHOLD <= 0) {
  console.error('用法: node scripts/verify-style-tokens.mjs <before.css> <after.css> [--max <ΔE>]');
  process.exit(2);
}

const before = flattenRules(readFileSync(beforePath, 'utf8')).match(COLOUR) ?? [];
const after = flattenRules(readFileSync(afterPath, 'utf8')).match(COLOUR) ?? [];

if (before.length !== after.length) {
  console.error(`✗ 颜色数量不一致：改前 ${before.length} 处，改后 ${after.length} 处`);
  process.exit(1);
}

const measured = [];
for (const [index, raw] of before.entries()) {
  const a = parseColour(raw);
  const b = parseColour(after[index]);
  if (!a || !b) continue;
  measured.push({ raw, next: after[index], distance: deltaE(toLab(a), toLab(b)) });
}
measured.sort((left, right) => right.distance - left.distance);

const worst = measured.length ? measured[0].distance : 0;
const failures = measured.filter((entry) => entry.distance >= THRESHOLD);
const seen = new Set();
for (const { raw, next, distance } of failures) {
  const line = `${raw} → ${next}  ΔE=${distance.toFixed(2)}`;
  if (seen.has(line)) continue;
  seen.add(line);
  console.error(`  ✗ ${line}`);
}

/** Above ΔE 1 the question stops being "did it change" and becomes "how far", so show the spread. */
const at = (fraction) =>
  measured[Math.min(measured.length - 1, Math.floor(measured.length * fraction))];
if (THRESHOLD > DEFAULT_THRESHOLD && measured.length) {
  const moved = measured.filter((entry) => entry.distance >= DEFAULT_THRESHOLD).length;
  console.log(
    `  肉眼可辨（ΔE ≥ ${DEFAULT_THRESHOLD}）${moved} 处；` +
      `中位 ${at(0.5).distance.toFixed(2)}，前 10% ${at(0.1).distance.toFixed(2)}`,
  );
}
console.log(
  `${failures.length ? '✗' : '✓'} 比对 ${before.length} 处颜色，` +
    `最大色差 ΔE = ${worst.toFixed(3)}（上限 ${THRESHOLD}），超标 ${failures.length} 处`,
);
process.exit(failures.length ? 1 : 0);
