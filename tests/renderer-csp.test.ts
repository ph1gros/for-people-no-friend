import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('renderer content security policy', () => {
  const html = readFileSync(resolve('src/renderer/index.html'), 'utf8');
  const policy = html.match(/Content-Security-Policy"\s+content="([^"]+)"/u)?.[1] ?? '';

  it('ships a production-safe policy without a development websocket origin', () => {
    expect(policy).not.toContain('ws://127.0.0.1:5173');
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it('keeps the managed Live2D protocol available without widening scripts', () => {
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("img-src 'self' data: blob: deskpet-model:");
    expect(policy).toContain("connect-src 'self' deskpet-model:");
  });
});
