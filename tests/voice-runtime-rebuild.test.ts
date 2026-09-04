import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('clean voice runtime recipe', () => {
  it('pins the ONNX-only dependency graph without the PyTorch ecosystem', async () => {
    const lock = await readFile(
      path.join(process.cwd(), 'resources', 'voice-runtime', 'requirements.lock'),
      'utf8',
    );
    expect(lock).toContain('onnxruntime-directml==1.23.0');
    expect(lock).toContain('Style-Bert-VITS2.git@d8148f3090ee5038ca7b4e4b327116c64467f952');
    expect(lock).not.toMatch(/^onnxruntime==/mu);
    expect(lock).not.toMatch(/^(?:torch|torchaudio|scipy|numba|librosa|modelscope)==/mu);
  });

  it('verifies downloaded runtimes and rejects dirty build output', async () => {
    const script = await readFile(
      path.join(process.cwd(), 'scripts', 'rebuild-clean-voice-runtime.ps1'),
      'utf8',
    );
    expect(script).toContain('Get-FileHash');
    expect(script).toContain('--no-deps');
    expect(script).toContain("'onnxruntime_directml-*'");
    expect(script).toContain('Duplicate dist-info entries remain');
    expect(script).toContain('The clean voice runtime output must stay inside');
  });
});
