import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync('src/main/windows/create-main-window.ts', 'utf8');

describe('microphone permission boundary', () => {
  it('allows only audio capture from the trusted main renderer', () => {
    expect(source).toContain("permission !== 'media'");
    expect(source).toContain("mediaTypes[0] !== 'audio'");
    expect(source).toContain('requestingWebContents !== window.webContents');
    expect(source).toContain('details.isMainFrame');
    expect(source).toContain("origin.protocol === 'file:'");
    expect(source).toContain(
      "window.webContents.on('will-navigate', (event) => event.preventDefault())",
    );
  });
});
