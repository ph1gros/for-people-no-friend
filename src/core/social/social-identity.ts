import {
  SOCIAL_ID_PATTERN,
  SOCIAL_MAX_DISPLAY_NAME_LENGTH,
  SOCIAL_ID_TOKEN_PATTERN,
  isSocialPlatform,
  type SocialIdHasher,
  type SocialMessage,
  type SocialPlatform,
} from './social-contracts';

export const SOCIAL_ACTOR_CLASSES = ['owner', 'known-user', 'guest', 'unknown'] as const;

export type SocialActorClass = (typeof SOCIAL_ACTOR_CLASSES)[number];

/**
 * A platform account the user has explicitly claimed. `owner` is the user's own account on that
 * platform; `known-user` is somebody the user deliberately introduced to the character.
 */
export interface SocialActorBinding {
  platform: SocialPlatform;
  userId: string;
  actorClass: Extract<SocialActorClass, 'owner' | 'known-user'>;
  label?: string;
}

export interface SocialActor {
  /** De-identified, stable across restarts. Safe to persist and to use as a memory key part. */
  actorId: string;
  actorClass: SocialActorClass;
  platform: SocialPlatform;
  /** Platform-provided nickname. Display only; never used to key storage. */
  displayName?: string;
  /** User-provided label from an explicit binding. */
  label?: string;
}

const bindingKey = (platform: SocialPlatform, userId: string): string =>
  `${platform}\u0000${userId}`;

export const validateSocialActorBinding = (value: unknown): SocialActorBinding => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The social actor binding is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (
    !isSocialPlatform(record.platform) ||
    typeof record.userId !== 'string' ||
    !SOCIAL_ID_PATTERN.test(record.userId) ||
    (record.actorClass !== 'owner' && record.actorClass !== 'known-user') ||
    (record.label !== undefined &&
      (typeof record.label !== 'string' ||
        record.label.trim().length === 0 ||
        record.label.length > SOCIAL_MAX_DISPLAY_NAME_LENGTH))
  ) {
    throw new Error('The social actor binding is invalid.');
  }
  const binding: SocialActorBinding = {
    platform: record.platform as SocialPlatform,
    userId: record.userId,
    actorClass: record.actorClass,
  };
  if (typeof record.label === 'string') binding.label = record.label.trim();
  return binding;
};

/**
 * Maps native platform identities onto internal actors. Desktop FPNF can assume `user = owner`;
 * a social surface cannot, so every external identity is classified before it reaches memory.
 */
export class SocialActorDirectory {
  private readonly bindings = new Map<string, SocialActorBinding>();
  private readonly tokenBindings = new Map<string, 'owner' | 'known-user'>();

  public constructor(
    private readonly hashUserId: SocialIdHasher,
    bindings: readonly SocialActorBinding[] = [],
  ) {
    for (const binding of bindings) this.bind(binding);
  }

  public bind(binding: SocialActorBinding): void {
    const validated = validateSocialActorBinding(binding);
    this.bindings.set(bindingKey(validated.platform, validated.userId), validated);
  }

  public unbind(platform: SocialPlatform, userId: string): boolean {
    return this.bindings.delete(bindingKey(platform, userId));
  }

  /** Configuration replacement revokes raw and token-enrolled privileges alike. */
  public clearBindings(): void {
    this.bindings.clear();
    this.tokenBindings.clear();
  }

  /** Explicit local enrollment can persist a hash instead of the platform account identifier. */
  public bindToken(
    platform: SocialPlatform,
    token: string,
    actorClass: 'owner' | 'known-user',
  ): void {
    if (
      !isSocialPlatform(platform) ||
      !SOCIAL_ID_TOKEN_PATTERN.test(token) ||
      (actorClass !== 'owner' && actorClass !== 'known-user')
    ) {
      throw new Error('The social actor binding is invalid.');
    }
    this.tokenBindings.set(bindingKey(platform, token), actorClass);
  }

  public resolve(message: SocialMessage): SocialActor {
    const { platform } = message.target;
    const token = this.hashUserId(platform, message.userId);
    if (typeof token !== 'string' || !SOCIAL_ID_TOKEN_PATTERN.test(token)) {
      throw new Error('The social identity hasher returned an invalid token.');
    }
    const binding = this.bindings.get(bindingKey(platform, message.userId));
    const actor: SocialActor = {
      actorId: `${platform}-${token}`,
      actorClass:
        binding?.actorClass ??
        this.tokenBindings.get(bindingKey(platform, token)) ??
        (message.target.channelKind === 'direct' ? 'guest' : 'unknown'),
      platform,
    };
    if (message.displayName !== undefined) actor.displayName = message.displayName;
    if (binding?.label !== undefined) actor.label = binding.label;
    return actor;
  }

  public snapshot(): SocialActorBinding[] {
    return [...this.bindings.values()].map((binding) => ({ ...binding }));
  }
}
