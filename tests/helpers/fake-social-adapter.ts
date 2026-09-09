import type {
  SocialAdapterCapabilities,
  SocialAudioPayload,
  SocialMessage,
  SocialMessageHandler,
  SocialPlatform,
  SocialPlatformAdapter,
  SocialTarget,
} from '../../src/core/social/social-contracts';

export interface FakeSocialAdapterOptions {
  capabilities?: Partial<Omit<SocialAdapterCapabilities, 'text'>>;
  connectError?: Error;
  disconnectError?: Error;
  sendTextError?: Error;
}

export class FakeSocialAdapter implements SocialPlatformAdapter {
  public readonly capabilities: SocialAdapterCapabilities;
  public readonly sentText: Array<{ target: SocialTarget; text: string }> = [];
  public readonly sentAudio: Array<{ target: SocialTarget; audio: SocialAudioPayload }> = [];
  public connectCalls = 0;
  public disconnectCalls = 0;

  private readonly handlers = new Set<SocialMessageHandler>();

  public constructor(
    public readonly platform: SocialPlatform,
    private readonly options: FakeSocialAdapterOptions = {},
  ) {
    this.capabilities = {
      text: true,
      audioMessage: options.capabilities?.audioMessage ?? false,
      voiceChannel: options.capabilities?.voiceChannel ?? false,
      streamingText: options.capabilities?.streamingText ?? false,
    };
  }

  public async connect(): Promise<void> {
    this.connectCalls += 1;
    if (this.options.connectError) throw this.options.connectError;
  }

  public async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    if (this.options.disconnectError) throw this.options.disconnectError;
  }

  public onMessage(handler: SocialMessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  public async sendText(target: SocialTarget, text: string): Promise<void> {
    if (this.options.sendTextError) throw this.options.sendTextError;
    this.sentText.push({ target, text });
  }

  public async sendAudio(target: SocialTarget, audio: SocialAudioPayload): Promise<void> {
    this.sentAudio.push({ target, audio });
  }

  public get handlerCount(): number {
    return this.handlers.size;
  }

  public emit(message: SocialMessage): void {
    for (const handler of [...this.handlers]) handler(message);
  }
}

let sequence = 0;

export const createSocialMessage = (overrides: Partial<SocialMessage> = {}): SocialMessage => {
  sequence += 1;
  const target: SocialTarget = {
    platform: 'qq',
    channelKind: 'direct',
    channelId: 'channel-1',
    ...overrides.target,
  };
  return {
    messageId: `message-${sequence}`,
    userId: 'user-1',
    text: 'hello',
    mentionsCharacter: false,
    receivedAt: 1_700_000_000_000,
    ...overrides,
    target,
  };
};

/** Deterministic stand-in for the salted sha256 hasher used in the main process. */
export const fakeHashId = (platform: SocialPlatform, value: string): string => {
  let hash = 0x811c9dc5;
  for (const character of `${platform}:${value}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').repeat(3);
};
