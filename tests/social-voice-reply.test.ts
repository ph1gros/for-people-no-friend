import { describe, expect, it, vi } from 'vitest';

import {
  SocialConversationRouter,
  type SocialConversationPort,
} from '../src/core/social/social-conversation-router';
import { SocialActorDirectory } from '../src/core/social/social-identity';
import { SocialAdapterRegistry } from '../src/core/social/social-registry';
import { encodeWavPcm16 } from '../src/core/social/social-voice';
import { SocialVoiceCodec } from '../src/main/social/social-voice-codec';
import { createSocialVoiceSynthesizer } from '../src/main/social/social-voice-reply';
import { FakeSocialAdapter, createSocialMessage, fakeHashId } from './helpers/fake-social-adapter';

const wav = (frames = 1_600): Uint8Array =>
  encodeWavPcm16({ sampleRate: 16_000, samples: new Int16Array(frames).fill(1_234) });

const silkModule = () => ({
  isSilk: (data: Uint8Array) => data[0] === 0x02,
  decode: async () => ({ data: new Uint8Array(320), duration: 10 }),
  encode: async () => ({ data: Uint8Array.from([0x02, 0x11, 0x22]), duration: 900 }),
});

const createSynthesizer = (
  overrides: {
    enabled?: boolean;
    speechResult?: unknown;
    codec?: SocialVoiceCodec;
  } = {},
) => {
  const speech = {
    synthesize: vi.fn(
      async () =>
        (overrides.speechResult ?? {
          ok: true,
          requestId: 'r',
          audio: wav(),
          mimeType: 'audio/wav',
          text: 'hello',
        }) as never,
    ),
    cancel: vi.fn(() => true),
  };
  const synthesizer = createSocialVoiceSynthesizer({
    speech,
    codec: overrides.codec ?? new SocialVoiceCodec(async () => silkModule()),
    isEnabled: () => overrides.enabled ?? true,
  });
  return { synthesizer, speech };
};

describe('social voice synthesizer', () => {
  it('turns a reply into a SILK clip with its duration', async () => {
    const { synthesizer, speech } = createSynthesizer();

    const audio = await synthesizer.synthesize('  你好  ', new AbortController().signal);

    expect(audio).toEqual({
      mimeType: 'audio/silk',
      data: Uint8Array.from([0x02, 0x11, 0x22]),
      durationMs: 900,
    });
    expect(speech.synthesize).toHaveBeenCalledWith(expect.objectContaining({ text: '你好' }));
  });

  it('stays silent when the feature is off or the text is empty', async () => {
    const disabled = createSynthesizer({ enabled: false });
    expect(
      await disabled.synthesizer.synthesize('hi', new AbortController().signal),
    ).toBeUndefined();
    expect(disabled.speech.synthesize).not.toHaveBeenCalled();

    const empty = createSynthesizer();
    expect(await empty.synthesizer.synthesize('   ', new AbortController().signal)).toBeUndefined();
    expect(empty.speech.synthesize).not.toHaveBeenCalled();
  });

  it('falls back to text when the provider does not emit WAV', async () => {
    const { synthesizer } = createSynthesizer({
      speechResult: {
        ok: true,
        requestId: 'r',
        audio: Uint8Array.from([1, 2, 3]),
        mimeType: 'audio/mpeg',
        text: 'hello',
      },
    });

    expect(await synthesizer.synthesize('hi', new AbortController().signal)).toBeUndefined();
  });

  it('falls back to text when synthesis fails or the codec is unavailable', async () => {
    const failed = createSynthesizer({
      speechResult: { ok: false, requestId: 'r', cancelled: false, message: 'nope' },
    });
    expect(await failed.synthesizer.synthesize('hi', new AbortController().signal)).toBeUndefined();

    const noCodec = createSynthesizer({ codec: new SocialVoiceCodec(async () => undefined) });
    expect(
      await noCodec.synthesizer.synthesize('hi', new AbortController().signal),
    ).toBeUndefined();
  });

  it('never lets a speech failure escape as an exception', async () => {
    const synthesizer = createSocialVoiceSynthesizer({
      speech: {
        synthesize: async () => {
          throw new Error('tts exploded');
        },
        cancel: () => true,
      },
      codec: new SocialVoiceCodec(async () => silkModule()),
      isEnabled: () => true,
    });

    await expect(
      synthesizer.synthesize('hi', new AbortController().signal),
    ).resolves.toBeUndefined();
  });

  it('cancels the pending synthesis when the turn is aborted', async () => {
    const controller = new AbortController();
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cancel = vi.fn(() => true);
    const synthesizer = createSocialVoiceSynthesizer({
      speech: {
        synthesize: async () => {
          await gate;
          return { ok: true, requestId: 'r', audio: wav(), mimeType: 'audio/wav', text: 'hi' };
        },
        cancel,
      },
      codec: new SocialVoiceCodec(async () => silkModule()),
      isEnabled: () => true,
    });

    const pending = synthesizer.synthesize('hi', controller.signal);
    controller.abort();
    release();

    expect(await pending).toBeUndefined();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('refuses to start once the turn is already aborted', async () => {
    const { synthesizer, speech } = createSynthesizer();
    const controller = new AbortController();
    controller.abort();

    expect(await synthesizer.synthesize('hi', controller.signal)).toBeUndefined();
    expect(speech.synthesize).not.toHaveBeenCalled();
  });
});

const routerHarness = (
  respond: SocialConversationPort['respond'],
  adapterOptions: ConstructorParameters<typeof FakeSocialAdapter>[1] = {},
) => {
  const registry = new SocialAdapterRegistry(() => 1_700_000_000_000);
  const adapter = new FakeSocialAdapter('qq', adapterOptions);
  registry.register(adapter);
  const router = new SocialConversationRouter({
    registry,
    directory: new SocialActorDirectory(fakeHashId),
    port: { respond },
    hashId: fakeHashId,
    getContext: () => ({ characterNamespace: 'character-abc123' }),
  });
  router.start();
  return { adapter, router };
};

const clip = { mimeType: 'audio/silk', data: Uint8Array.from([0x02, 0x09]) };

describe('router voice delivery', () => {
  it('sends a voice note instead of text when the adapter supports it', async () => {
    const h = routerHarness(async () => ({ text: 'spoken reply', audio: clip }), {
      capabilities: { audioMessage: true },
    });

    h.adapter.emit(createSocialMessage());
    await h.router.drain();

    expect(h.adapter.sentAudio).toHaveLength(1);
    expect(h.adapter.sentAudio[0]?.audio).toEqual(clip);
    expect(h.adapter.sentText).toHaveLength(0);
  });

  it('falls back to text when the adapter never declared the capability', async () => {
    const h = routerHarness(async () => ({ text: 'spoken reply', audio: clip }));

    h.adapter.emit(createSocialMessage());
    await h.router.drain();

    expect(h.adapter.sentAudio).toHaveLength(0);
    expect(h.adapter.sentText[0]?.text).toBe('spoken reply');
  });

  it('sends text whenever the reply carries no clip', async () => {
    const h = routerHarness(async () => ({ text: 'plain reply' }), {
      capabilities: { audioMessage: true },
    });

    h.adapter.emit(createSocialMessage());
    await h.router.drain();

    expect(h.adapter.sentAudio).toHaveLength(0);
    expect(h.adapter.sentText[0]?.text).toBe('plain reply');
  });
});
