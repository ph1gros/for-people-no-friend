import { readFile } from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnimatedWebpDriver } from '../src/renderer/character/animated-webp-driver';
import { waitForVisibleCharacterFrame } from '../src/renderer/live2d/character-runtime';
import { parseAnimatedWebpCharacterManifest } from '../src/renderer/character/character-manifest';

const asset = {
  id: 'idle',
  file: 'media/idle.webp',
  width: 500,
  height: 500,
  frameCount: 12,
  durationMs: 960,
  sha256: 'a'.repeat(64),
  tags: ['format:animated-webp', 'state:idle'],
};

const validManifest = {
  schemaVersion: 1,
  id: 'test-character',
  templateVersion: '1.0.0',
  name: '测试角色',
  renderer: 'animated-webp',
  canvas: { width: 500, height: 500 },
  presentation: { scale: 0.78 },
  attribution: {
    creator: '测试作者',
    creatorUrl: 'https://example.com/creator',
    sourceUrl: 'https://example.com/source',
    permission: '测试许可。',
  },
  assets: [asset],
  channels: {
    states: { idle: 'idle', thinking: 'idle', talking: 'idle' },
    emotions: {
      neutral: 'idle',
      happy: 'idle',
      sad: 'idle',
      angry: 'idle',
      surprised: 'idle',
      shy: 'idle',
      playful: 'idle',
    },
    actions: { wave: 'idle' },
  },
};

describe('versioned animated WebP character manifest', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a local versioned pack with explicit channels and attribution', () => {
    expect(parseAnimatedWebpCharacterManifest(validManifest)).toMatchObject({
      id: 'test-character',
      renderer: 'animated-webp',
      presentation: { scale: 0.78 },
      channels: { states: { idle: 'idle' } },
    });
  });

  it('keeps old packs at full scale and rejects unsafe presentation scales', () => {
    const legacyManifest = { ...validManifest, presentation: undefined };
    expect(parseAnimatedWebpCharacterManifest(legacyManifest)?.presentation.scale).toBe(1);
    expect(
      parseAnimatedWebpCharacterManifest({
        ...validManifest,
        presentation: { scale: 0.1 },
      }),
    ).toBeUndefined();
  });

  it('rejects traversal, remote media, missing channels and malformed metadata', () => {
    for (const file of ['../idle.webp', '/idle.webp', 'https://example.com/idle.webp']) {
      expect(
        parseAnimatedWebpCharacterManifest({
          ...validManifest,
          assets: [{ ...asset, file }],
        }),
      ).toBeUndefined();
    }
    expect(
      parseAnimatedWebpCharacterManifest({
        ...validManifest,
        channels: { ...validManifest.channels, states: { idle: 'idle' } },
      }),
    ).toBeUndefined();
    expect(
      parseAnimatedWebpCharacterManifest({
        ...validManifest,
        assets: [{ ...asset, width: 500, height: 264 }],
      }),
    ).toBeUndefined();
  });

  it('validates the shipped Irena catalog and its detailed tags', async () => {
    const manifest = JSON.parse(
      await readFile('assets/characters/irena/v1/character.json', 'utf8'),
    ) as unknown;
    const parsed = parseAnimatedWebpCharacterManifest(manifest);
    expect(parsed).toMatchObject({
      id: 'irena',
      name: '伊雷娜',
      attribution: { creator: '白之魔女-霜娜' },
    });
    expect(parsed?.assets).toHaveLength(53);
    expect(parsed?.channels.states.idle).toBe('敲键盘_慢的');
    expect(parsed?.presentation.scale).toBe(0.78);
    expect(parsed?.channels.emotions.happy).toBe('打字_开心');
    expect(parsed?.assets.find(({ id }) => id === '探头_慢_眨眼')?.tags).toContain(
      'quality:matte-background',
    );
    expect(parsed?.assets.find(({ id }) => id === '敲键盘_快且生气的')?.tags).toEqual(
      expect.arrayContaining(['action:typing', 'emotion:angry', 'action-id:type_angry']),
    );
  });

  it('restores the current emotion after a one-shot WebP action', async () => {
    const parsed = parseAnimatedWebpCharacterManifest({
      ...validManifest,
      assets: [
        asset,
        { ...asset, id: 'happy', file: 'media/happy.webp' },
        { ...asset, id: 'wave', file: 'media/wave.webp', durationMs: 100 },
      ],
      channels: {
        ...validManifest.channels,
        emotions: { ...validManifest.channels.emotions, happy: 'happy' },
        actions: { wave: 'wave' },
      },
    });
    expect(parsed).toBeDefined();
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void): number => {
        callback();
        return 1;
      },
    });
    const rendered: string[] = [];
    const fakeImage = {
      offsetWidth: 500,
      removeAttribute: () => undefined,
      remove: () => undefined,
      set src(value: string) {
        rendered.push(value);
      },
    } as unknown as HTMLImageElement;
    const driver = new AnimatedWebpDriver(fakeImage, parsed!);
    await driver.playState({ group: 'idle' });
    await driver.setExpression('happy');
    await driver.playAction({ group: 'wave' });
    expect(rendered.at(-2)).toContain('/wave.webp');
    expect(rendered.at(-1)).toContain('/happy.webp');
  });

  it('lets thinking and talking override an older emotion, then restores it on idle', async () => {
    const parsed = parseAnimatedWebpCharacterManifest({
      ...validManifest,
      assets: [
        asset,
        { ...asset, id: 'thinking', file: 'media/thinking.webp' },
        { ...asset, id: 'talking', file: 'media/talking.webp' },
        { ...asset, id: 'angry', file: 'media/angry.webp' },
      ],
      channels: {
        ...validManifest.channels,
        states: { idle: 'idle', thinking: 'thinking', talking: 'talking' },
        emotions: { ...validManifest.channels.emotions, angry: 'angry' },
      },
    });
    const rendered: string[] = [];
    const fakeImage = {
      offsetWidth: 500,
      removeAttribute: () => undefined,
      remove: () => undefined,
      set src(value: string) {
        rendered.push(value);
      },
    } as unknown as HTMLImageElement;
    const driver = new AnimatedWebpDriver(fakeImage, parsed!);

    await driver.playState({ group: 'idle' });
    await driver.setExpression('angry');
    await driver.playState({ group: 'thinking' });
    await driver.playState({ group: 'talking' });
    await driver.playState({ group: 'idle' });

    expect(rendered.map((url) => url.split('/').at(-1))).toEqual([
      'idle.webp',
      'angry.webp',
      'thinking.webp',
      'talking.webp',
      'angry.webp',
    ]);
  });

  it('does not clear the image when idle and neutral resolve to the same WebP', async () => {
    const parsed = parseAnimatedWebpCharacterManifest(validManifest);
    expect(parsed).toBeDefined();
    const rendered: string[] = [];
    let cleared = 0;
    const fakeImage = {
      offsetWidth: 500,
      removeAttribute: () => {
        cleared += 1;
      },
      remove: () => undefined,
      set src(value: string) {
        rendered.push(value);
      },
    } as unknown as HTMLImageElement;
    const driver = new AnimatedWebpDriver(fakeImage, parsed!);

    await Promise.all([driver.playState({ group: 'idle' }), driver.setExpression('idle')]);

    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toContain('/idle.webp');
    expect(cleared).toBe(0);
  });
});

describe('character renderer readiness', () => {
  it('does not accept an empty canvas before a later visible Live2D frame', async () => {
    const refresh = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const waitForNextFrame = vi.fn(async () => undefined);

    await expect(waitForVisibleCharacterFrame(refresh, 5, waitForNextFrame)).resolves.toBe(true);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(waitForNextFrame).toHaveBeenCalledTimes(3);
  });

  it('reports a renderer that stays fully transparent', async () => {
    const refresh = vi.fn(() => false);

    await expect(waitForVisibleCharacterFrame(refresh, 3, async () => undefined)).resolves.toBe(
      false,
    );
    expect(refresh).toHaveBeenCalledTimes(3);
  });
});
