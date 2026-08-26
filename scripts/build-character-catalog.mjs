import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const charactersRoot = path.join(repositoryRoot, 'assets', 'characters');
const identifierPattern = /^[A-Za-z0-9_-]{1,64}$/;

const readWebpMetadata = (buffer) => {
  if (
    buffer.length < 30 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    throw new Error('文件签名不是 WebP。');
  }

  let offset = 12;
  let width;
  let height;
  let animated = false;
  let alpha = false;
  let frameCount = 0;
  let durationMs = 0;
  while (offset + 8 <= buffer.length) {
    const chunk = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + size > buffer.length) {
      throw new Error('WebP 数据块长度无效。');
    }
    if (chunk === 'VP8X' && size >= 10) {
      const flags = buffer[dataOffset];
      animated = Boolean(flags & 0x02);
      alpha = Boolean(flags & 0x10);
      width =
        1 + buffer[dataOffset + 4] + (buffer[dataOffset + 5] << 8) + (buffer[dataOffset + 6] << 16);
      height =
        1 + buffer[dataOffset + 7] + (buffer[dataOffset + 8] << 8) + (buffer[dataOffset + 9] << 16);
    }
    if (chunk === 'ANMF' && size >= 16) {
      frameCount += 1;
      durationMs +=
        buffer[dataOffset + 12] + (buffer[dataOffset + 13] << 8) + (buffer[dataOffset + 14] << 16);
    }
    offset = dataOffset + size + (size & 1);
  }

  if (!width || !height || !animated || !alpha || frameCount < 2 || durationMs <= 0) {
    throw new Error('角色资源必须是带透明通道的多帧动态 WebP。');
  }
  if (width !== height || width > 1_024 || width < 128) {
    throw new Error('角色资源必须是 128～1024 像素的正方形画布。');
  }
  return { width, height, frameCount, durationMs };
};

const TAG_RULES = [
  ['开心', 'emotion:happy'],
  ['流泪', 'emotion:sad'],
  ['委屈', 'emotion:sad'],
  ['生气', 'emotion:angry'],
  ['愤怒', 'emotion:angry'],
  ['惊讶', 'emotion:surprised'],
  ['害羞', 'emotion:shy'],
  ['慌张', 'emotion:surprised'],
  ['期待', 'emotion:playful'],
  ['期待', 'mood:expectant'],
  ['崇拜', 'emotion:happy'],
  ['崇拜', 'mood:admiring'],
  ['困倦', 'mood:sleepy'],
  ['委屈', 'mood:wronged'],
  ['慌张', 'mood:nervous'],
  ['威胁', 'mood:threatening'],
  ['傻了吧唧', 'mood:silly'],
  ['何意味', 'mood:confused'],
  ['搞钱', 'mood:money-minded'],
  ['阴郁', 'mood:gloomy'],
  ['阴暗', 'mood:gloomy'],
  ['入场', 'action:entrance'],
  ['打字', 'action:typing'],
  ['键盘', 'action:typing'],
  ['记笔记', 'action:notes'],
  ['爱心', 'action:love'],
  ['红包', 'action:red-packet'],
  ['魔杖', 'action:magic'],
  ['魔棒', 'action:magic'],
  ['睡着', 'action:sleep'],
  ['点赞', 'action:approval'],
  ['倒赞', 'action:disapproval'],
  ['举牌', 'action:score'],
  ['奶茶', 'action:drink'],
  ['开车', 'action:drive'],
  ['摸头', 'action:head-pat'],
  ['握拳', 'gesture:fist'],
  ['捂嘴', 'gesture:cover-mouth'],
  ['张嘴', 'expression:mouth-open'],
  ['闭嘴', 'expression:mouth-closed'],
  ['流口水', 'expression:drooling'],
  ['星星眼', 'expression:star-eyes'],
  ['斗鸡眼', 'expression:cross-eyed'],
  ['眼睛打转', 'expression:dizzy-eyes'],
  ['眼睛眯起来', 'expression:squint'],
  ['键盘', 'prop:keyboard'],
  ['钞票', 'prop:money'],
  ['红包', 'prop:red-packet'],
  ['爱心', 'prop:heart'],
  ['玫瑰', 'prop:rose'],
  ['魔杖', 'prop:wand'],
  ['魔棒', 'prop:wand'],
  ['木棍', 'prop:stick'],
  ['奶茶', 'prop:milk-tea'],
  ['筷子', 'prop:chopsticks'],
  ['勺子', 'prop:spoon'],
  ['刀叉', 'prop:cutlery'],
  ['举牌', 'prop:score-sign'],
  ['开车', 'prop:car'],
  ['快速', 'tempo:fast'],
  ['快的', 'tempo:fast'],
  ['慢', 'tempo:slow'],
  ['眨眼', 'motion:blink'],
  ['摇', 'motion:shake'],
  ['转', 'motion:spin'],
  ['探头', 'motion:peek'],
];

const tagsFor = (name, config) => {
  const tags = new Set(['format:animated-webp']);
  if (config.matteBackgroundAssets?.includes(name)) tags.add('quality:matte-background');
  for (const [needle, tag] of TAG_RULES) {
    if (name.includes(needle)) tags.add(tag);
  }
  for (const [state, asset] of Object.entries(config.states)) {
    if (asset === name) tags.add(`state:${state}`);
  }
  for (const [emotion, asset] of Object.entries(config.emotions)) {
    if (asset === name) tags.add(`emotion:${emotion}`);
  }
  for (const [action, asset] of Object.entries(config.actions)) {
    if (asset === name) tags.add(`action-id:${action}`);
  }
  return [...tags].sort();
};

const buildPack = async (packDirectory) => {
  const configPath = path.join(packDirectory, 'pack.config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (
    config.version !== 1 ||
    !identifierPattern.test(config.id) ||
    typeof config.templateVersion !== 'string' ||
    !config.templateVersion ||
    typeof config.name !== 'string' ||
    !config.name ||
    !config.canvas ||
    !Number.isInteger(config.canvas.width) ||
    !Number.isInteger(config.canvas.height)
  ) {
    throw new Error(`${configPath}: 角色包配置无效。`);
  }
  if (
    config.presentation !== undefined &&
    (!config.presentation ||
      typeof config.presentation !== 'object' ||
      typeof config.presentation.scale !== 'number' ||
      !Number.isFinite(config.presentation.scale) ||
      config.presentation.scale < 0.4 ||
      config.presentation.scale > 1)
  ) {
    throw new Error(`${configPath}: 角色画面占比必须在 0.4～1 之间。`);
  }
  for (const action of Object.keys(config.actions)) {
    if (!identifierPattern.test(action)) {
      throw new Error(`${configPath}: 动作 ID ${action} 无效。`);
    }
  }
  if (
    config.matteBackgroundAssets !== undefined &&
    (!Array.isArray(config.matteBackgroundAssets) ||
      config.matteBackgroundAssets.some(
        (asset) => typeof asset !== 'string' || asset.length === 0 || asset.length > 120,
      ))
  ) {
    throw new Error(`${configPath}: 带底色资源列表无效。`);
  }

  const mediaDirectory = path.join(packDirectory, 'media');
  const filenames = (await readdir(mediaDirectory))
    .filter((name) => name.toLowerCase().endsWith('.webp'))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
  if (filenames.length === 0 || filenames.length > 128) {
    throw new Error(`${mediaDirectory}: 动态 WebP 数量必须为 1～128。`);
  }

  const assets = [];
  for (const filename of filenames) {
    const basename = path.basename(filename, path.extname(filename));
    const buffer = await readFile(path.join(mediaDirectory, filename));
    let metadata;
    try {
      metadata = readWebpMetadata(buffer);
    } catch (error) {
      throw new Error(`${filename}: ${error instanceof Error ? error.message : '文件无效。'}`, {
        cause: error,
      });
    }
    assets.push({
      id: basename,
      file: `media/${filename}`,
      ...metadata,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      tags: tagsFor(basename, config),
    });
  }

  const assetIds = new Set(assets.map(({ id }) => id));
  const matteBackgroundAssets = new Set(config.matteBackgroundAssets ?? []);
  for (const [channel, mapping] of Object.entries({
    states: config.states,
    emotions: config.emotions,
    actions: config.actions,
  })) {
    for (const [key, asset] of Object.entries(mapping)) {
      if (!assetIds.has(asset)) {
        throw new Error(`${configPath}: ${channel}.${key} 引用了不存在的资源 ${asset}。`);
      }
      if (matteBackgroundAssets.has(asset)) {
        throw new Error(`${configPath}: ${channel}.${key} 不能引用带不透明底色的资源 ${asset}。`);
      }
    }
  }

  const manifest = {
    schemaVersion: 1,
    id: config.id,
    templateVersion: config.templateVersion,
    name: config.name,
    renderer: 'animated-webp',
    canvas: config.canvas,
    presentation: { scale: config.presentation?.scale ?? 1 },
    attribution: config.attribution,
    assets,
    channels: {
      states: config.states,
      emotions: config.emotions,
      actions: config.actions,
    },
  };
  const outputPath = path.join(packDirectory, 'character.json');
  const prettierConfig = (await resolveConfig(outputPath)) ?? {};
  const formattedManifest = await format(JSON.stringify(manifest), {
    ...prettierConfig,
    filepath: outputPath,
  });
  await writeFile(outputPath, formattedManifest, 'utf8');
  return `${config.name}: ${assets.length} 个动态 WebP`;
};

const results = [];
for (const characterDirectoryEntry of await readdir(charactersRoot, { withFileTypes: true })) {
  if (!characterDirectoryEntry.isDirectory()) continue;
  const characterDirectory = path.join(charactersRoot, characterDirectoryEntry.name);
  for (const versionEntry of await readdir(characterDirectory, { withFileTypes: true })) {
    if (!versionEntry.isDirectory()) continue;
    const packDirectory = path.join(characterDirectory, versionEntry.name);
    try {
      await readFile(path.join(packDirectory, 'pack.config.json'), 'utf8');
    } catch {
      continue;
    }
    results.push(await buildPack(packDirectory));
  }
}

stdout.write(`角色资源清单已更新：${results.join('；')}\n`);
