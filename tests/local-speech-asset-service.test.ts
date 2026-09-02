import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalSpeechAssetService } from '../src/main/speech/local-speech-asset-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('LocalSpeechAssetService', () => {
  it('reports and exports only bounded voice products, never training source recordings', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'fpnf-speech-assets-'));
    temporaryDirectories.push(directory);
    const voiceRoot = path.join(directory, 'data', '伊雷娜音色_最终版');
    const trainingRoot = path.join(directory, 'data', 'style-bert-vits2-standalone');
    const sourceRoot = path.join(trainingRoot, '角色音源_放这里');
    const exportRoot = path.join(directory, 'exports');
    await Promise.all([
      mkdir(voiceRoot, { recursive: true }),
      mkdir(sourceRoot, { recursive: true }),
      mkdir(exportRoot, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        path.join(voiceRoot, 'config.json'),
        JSON.stringify({ data: { style2id: { Neutral: 0, Happy: 1 } } }),
      ),
      writeFile(path.join(voiceRoot, 'style_vectors.npy'), 'fake-vectors'),
      writeFile(path.join(voiceRoot, 'voice.safetensors'), 'fake-model'),
      writeFile(path.join(voiceRoot, 'preview.wav'), 'fake-preview'),
      writeFile(path.join(sourceRoot, 'private-source.wav'), 'must-not-export'),
      writeFile(path.join(trainingRoot, '打开-Style-Bert-VITS2-训练与推理.cmd'), '@echo off'),
    ]);
    const service = new LocalSpeechAssetService(path.join(directory, 'data'));

    expect(await service.getStatus()).toMatchObject({
      voiceName: '伊蕾娜（JP-Extra）',
      voiceAvailable: true,
      styles: ['Neutral', 'Happy'],
      trainingToolAvailable: true,
      trainingSourceReady: true,
    });

    const exported = await service.exportVoice(exportRoot);
    expect(exported.directoryName).toBe('FPNF-伊蕾娜-JP-Extra-音色');
    const exportedRoot = path.join(exportRoot, exported.directoryName);
    expect(await readFile(path.join(exportedRoot, 'voice.safetensors'), 'utf8')).toBe('fake-model');
    expect(await readFile(path.join(exportedRoot, 'FPNF-音色说明.txt'), 'utf8')).toContain(
      '不包含原始训练录音',
    );
    await expect(readFile(path.join(exportedRoot, 'private-source.wav'))).rejects.toThrow();
  });
});
