import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import type { LocalSpeechAssetStatus } from '../../shared/local-asset-ipc';
import { BUNDLED_IREINA_SPEECH_PRESET } from '../../shared/speech-ipc';

const VOICE_DIRECTORY_NAME = '伊雷娜音色_最终版';
const TRAINING_DIRECTORY_NAME = 'style-bert-vits2-standalone';
const TRAINER_FILE_NAME = '打开-Style-Bert-VITS2-训练与推理.cmd';
const TRAINING_SOURCE_DIRECTORY_NAME = '角色音源_放这里';
const REQUIRED_VOICE_FILES = ['config.json', 'style_vectors.npy'] as const;
const OPTIONAL_VOICE_FILE_PATTERN = /\.(?:safetensors|onnx|wav|txt)$/iu;
const MAX_VOICE_FILES = 16;
const MAX_VOICE_BYTES = 512 * 1024 * 1024;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

const createUniqueDirectory = async (parent: string, baseName: string): Promise<string> => {
  for (let index = 0; index < 100; index += 1) {
    const candidate = path.join(parent, index === 0 ? baseName : `${baseName}-${index + 1}`);
    try {
      await mkdir(candidate, { recursive: false });
      return candidate;
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') {
        throw error;
      }
    }
  }
  throw new Error('所选文件夹中已有过多同名音色导出。');
};

export interface ExportedLocalVoice {
  directoryName: string;
  fileCount: number;
  exportedBytes: number;
}

export class LocalSpeechAssetService {
  private voiceRoot: string;
  private readonly trainingRoot: string;

  public constructor(dataRoot: string, packagedVoiceRoot?: string) {
    this.voiceRoot = packagedVoiceRoot ?? path.join(dataRoot, VOICE_DIRECTORY_NAME);
    this.trainingRoot = path.join(dataRoot, TRAINING_DIRECTORY_NAME);
  }

  public getTrainingSourcePath(): string {
    return path.join(this.trainingRoot, TRAINING_SOURCE_DIRECTORY_NAME);
  }
  /** Main supplies only a root already validated by BundledSpeechRuntime. */
  public useInstalledVoice(voiceRoot: string): void {
    this.voiceRoot = voiceRoot;
  }

  public getTrainerPath(): string {
    return path.join(this.trainingRoot, TRAINER_FILE_NAME);
  }

  public async getStatus(): Promise<LocalSpeechAssetStatus> {
    const voiceFiles = await this.collectVoiceFiles().catch(() => []);
    const styles = await this.readStyles().catch(() => []);
    const [trainingToolAvailable, trainingSourceReady] = await Promise.all([
      this.isRegularFile(this.getTrainerPath()),
      this.isDirectory(this.getTrainingSourcePath()),
    ]);
    return {
      voiceName: `${BUNDLED_IREINA_SPEECH_PRESET.voiceDisplayName}（JP-Extra）`,
      voiceAvailable:
        REQUIRED_VOICE_FILES.every((fileName) =>
          voiceFiles.some((file) => file.name === fileName),
        ) && voiceFiles.some((file) => /\.(?:safetensors|onnx)$/iu.test(file.name)),
      voiceFileCount: voiceFiles.length,
      voiceBytes: voiceFiles.reduce((total, file) => total + file.bytes, 0),
      styles,
      trainingToolAvailable,
      trainingSourceReady,
    };
  }

  public async exportVoice(destinationParent: string): Promise<ExportedLocalVoice> {
    const destinationRoot = await realpath(destinationParent);
    const destinationStats = await lstat(destinationRoot);
    if (!destinationStats.isDirectory() || destinationStats.isSymbolicLink()) {
      throw new Error('所选导出位置不是有效文件夹。');
    }
    const voiceRoot = await realpath(this.voiceRoot);
    if (destinationRoot === voiceRoot || isWithin(voiceRoot, destinationRoot)) {
      throw new Error('不能把音色导出到它自己的源目录中。');
    }
    const files = await this.collectVoiceFiles();
    if (
      !REQUIRED_VOICE_FILES.every((fileName) => files.some((file) => file.name === fileName)) ||
      !files.some((file) => /\.(?:safetensors|onnx)$/iu.test(file.name))
    ) {
      throw new Error('当前本地音色成品不完整，无法导出。');
    }
    const exportedBytes = files.reduce((total, file) => total + file.bytes, 0);
    const destination = await createUniqueDirectory(
      destinationRoot,
      `FPNF-${BUNDLED_IREINA_SPEECH_PRESET.voiceDisplayName}-JP-Extra-音色`,
    );
    try {
      for (const file of files) {
        await copyFile(file.source, path.join(destination, file.name));
      }
      await writeFile(
        path.join(destination, 'FPNF-音色说明.txt'),
        [
          'For People No Friend 本地音色导出',
          '',
          '引擎：Style-Bert-VITS2 2.7.0 JP-Extra',
          '该文件夹只包含训练成品与试听文件，不包含原始训练录音。',
          '请只在声音素材授权范围内使用、分享或再次训练。',
          '',
        ].join('\r\n'),
        { encoding: 'utf8', mode: 0o600 },
      );
      return {
        directoryName: path.basename(destination),
        fileCount: files.length + 1,
        exportedBytes,
      };
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      throw error;
    }
  }

  private async collectVoiceFiles(): Promise<
    Array<{ name: string; source: string; bytes: number }>
  > {
    const voiceRoot = await realpath(this.voiceRoot);
    const entries = await readdir(voiceRoot, { withFileTypes: true });
    const selected = entries.filter(
      (entry) =>
        entry.isFile() &&
        (REQUIRED_VOICE_FILES.includes(entry.name as (typeof REQUIRED_VOICE_FILES)[number]) ||
          OPTIONAL_VOICE_FILE_PATTERN.test(entry.name)),
    );
    if (selected.length > MAX_VOICE_FILES) throw new Error('当前音色包含过多导出文件。');
    const files: Array<{ name: string; source: string; bytes: number }> = [];
    let totalBytes = 0;
    for (const entry of selected) {
      const candidate = path.join(voiceRoot, entry.name);
      const stats = await lstat(candidate);
      const canonical = await realpath(candidate);
      if (!stats.isFile() || stats.isSymbolicLink() || !isWithin(voiceRoot, canonical)) {
        throw new Error('当前音色包含无效或越界文件。');
      }
      totalBytes += stats.size;
      if (totalBytes > MAX_VOICE_BYTES) throw new Error('当前音色导出大小超过 512 MiB。');
      files.push({ name: entry.name, source: canonical, bytes: stats.size });
    }
    return files;
  }

  private async readStyles(): Promise<string[]> {
    const config = JSON.parse(
      await readFile(path.join(this.voiceRoot, 'config.json'), 'utf8'),
    ) as unknown;
    if (!isObject(config) || !isObject(config.data) || !isObject(config.data.style2id)) return [];
    return Object.keys(config.data.style2id).slice(0, 32);
  }

  private async isRegularFile(candidate: string): Promise<boolean> {
    try {
      const stats = await lstat(candidate);
      return stats.isFile() && !stats.isSymbolicLink();
    } catch {
      return false;
    }
  }

  private async isDirectory(candidate: string): Promise<boolean> {
    try {
      const stats = await lstat(candidate);
      return stats.isDirectory() && !stats.isSymbolicLink();
    } catch {
      return false;
    }
  }
}
