import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const policyOf = (file: string): string =>
  readFileSync(resolve(file), 'utf8').match(/Content-Security-Policy"\s+content="([^"]+)"/u)?.[1] ??
  '';

describe('renderer content security policy', () => {
  const policy = policyOf('src/renderer/index.html');

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

describe('resource centre window content security policy', () => {
  const policy = policyOf('src/renderer/resource-center.html');

  it('ships the same production-safe restrictions as the main window', () => {
    expect(policy).not.toContain('ws://127.0.0.1:5173');
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it('forbids network access, which this window never performs', () => {
    // The view submits known IDs and actions over IPC; download URLs never reach the renderer,
    // so nothing in this window should be able to open a connection.
    expect(policy).toContain("connect-src 'none'");
    expect(policy).not.toContain('deskpet-model:');
  });
});
