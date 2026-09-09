import { ipcMain } from 'electron';

import {
  KOOK_PRESENCE_PUBLIC_ERROR,
  QQ_PRESENCE_PUBLIC_ERROR,
  SOCIAL_IPC_CHANNELS,
  parseKookPresenceSnapshot,
  parseKookSettingsInput,
  parseKookVoiceInput,
  type KookVoiceInput,
  parseQqCharacterInput,
  parseQqPresenceSnapshot,
  parseQqSettingsInput,
  type KookPresenceSnapshot,
  type KookSettingsInput,
  type QqPresenceSnapshot,
  type QqSettingsInput,
} from '../../shared/social-ipc';
import {
  OOPZ_PRESENCE_PUBLIC_ERROR,
  parseOopzPresenceSnapshot,
  parseOopzSettingsInput,
  parseOopzStartInput,
  type OopzPresenceSnapshot,
  type OopzSettingsInput,
  type OopzStartInput,
} from '../../shared/social-ipc';
import { isTrustedIpcSender, type SenderValidationWindow } from './sender-validation';

export interface SocialIpcController {
  getWindow(): SenderValidationWindow | undefined;
  getSnapshot(): Promise<QqPresenceSnapshot>;
  save(input: QqSettingsInput): Promise<QqPresenceSnapshot>;
  connect(characterId: string): Promise<QqPresenceSnapshot>;
  disconnect(characterId: string): Promise<QqPresenceSnapshot>;
  deleteSecret(characterId: string): Promise<QqPresenceSnapshot>;
}

export interface KookIpcController {
  controlVoice?(input: KookVoiceInput): Promise<KookPresenceSnapshot>;
  getWindow(): SenderValidationWindow | undefined;
  getSnapshot(): Promise<KookPresenceSnapshot>;
  save(input: KookSettingsInput): Promise<KookPresenceSnapshot>;
  connect(characterId: string): Promise<KookPresenceSnapshot>;
  disconnect(characterId: string): Promise<KookPresenceSnapshot>;
  deleteSecret(characterId: string): Promise<KookPresenceSnapshot>;
}

/**
 * Registers only the platforms that were actually wired. A platform without a controller keeps
 * its channel unhandled, and teardown removes exactly what this call registered.
 */
/** Oopz carries two independent lifecycles: the bridge process and the OneBot connection. */
export interface OopzIpcController {
  getWindow(): SenderValidationWindow | undefined;
  getSnapshot(): Promise<OopzPresenceSnapshot>;
  save(input: OopzSettingsInput): Promise<OopzPresenceSnapshot>;
  startBridge(input: OopzStartInput): Promise<OopzPresenceSnapshot>;
  stopBridge(characterId: string): Promise<OopzPresenceSnapshot>;
  connect(characterId: string): Promise<OopzPresenceSnapshot>;
  disconnect(characterId: string): Promise<OopzPresenceSnapshot>;
  deleteSecret(characterId: string): Promise<OopzPresenceSnapshot>;
}

export const registerSocialIpcHandlers = (
  controller: SocialIpcController,
  kookController?: KookIpcController,
  oopzController?: OopzIpcController,
): (() => void) => {
  const registered: string[] = [];

  const register = <T>(
    channel: string,
    getWindow: () => SenderValidationWindow | undefined,
    publicError: string,
    project: (value: T) => T,
    operation: (input: unknown) => Promise<T>,
  ): void => {
    registered.push(channel);
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (!isTrustedIpcSender(event, getWindow())) {
        throw new Error('Unauthorized IPC sender.');
      }
      try {
        if (args.length > 1) throw new Error(publicError);
        return project(await operation(args[0]));
      } catch {
        // Electron serializes thrown errors: never let storage/SDK errors escape this boundary.
        throw new Error(publicError);
      }
    });
  };

  const registerQq = (
    channel: string,
    operation: (input: unknown) => Promise<QqPresenceSnapshot>,
  ): void =>
    register(
      channel,
      () => controller.getWindow(),
      QQ_PRESENCE_PUBLIC_ERROR,
      parseQqPresenceSnapshot,
      operation,
    );

  registerQq(SOCIAL_IPC_CHANNELS.getQqPresence, (input) => {
    if (input !== undefined) throw new Error(QQ_PRESENCE_PUBLIC_ERROR);
    return controller.getSnapshot();
  });
  registerQq(SOCIAL_IPC_CHANNELS.saveQqPresence, (input) =>
    controller.save(parseQqSettingsInput(input)),
  );
  registerQq(SOCIAL_IPC_CHANNELS.connectQqPresence, (input) =>
    controller.connect(parseQqCharacterInput(input).characterId),
  );
  registerQq(SOCIAL_IPC_CHANNELS.disconnectQqPresence, (input) =>
    controller.disconnect(parseQqCharacterInput(input).characterId),
  );
  registerQq(SOCIAL_IPC_CHANNELS.deleteQqSecret, (input) =>
    controller.deleteSecret(parseQqCharacterInput(input).characterId),
  );

  if (kookController) {
    const kook = kookController;
    const registerKook = (
      channel: string,
      operation: (input: unknown) => Promise<KookPresenceSnapshot>,
    ): void =>
      register(
        channel,
        () => kook.getWindow(),
        KOOK_PRESENCE_PUBLIC_ERROR,
        parseKookPresenceSnapshot,
        operation,
      );

    if (kook.controlVoice) {
      registerKook(SOCIAL_IPC_CHANNELS.controlKookVoice, (input) =>
        kook.controlVoice!(parseKookVoiceInput(input)),
      );
    }
    registerKook(SOCIAL_IPC_CHANNELS.getKookPresence, (input) => {
      if (input !== undefined) throw new Error(KOOK_PRESENCE_PUBLIC_ERROR);
      return kook.getSnapshot();
    });
    registerKook(SOCIAL_IPC_CHANNELS.saveKookPresence, (input) =>
      kook.save(parseKookSettingsInput(input)),
    );
    registerKook(SOCIAL_IPC_CHANNELS.connectKookPresence, (input) =>
      kook.connect(parseQqCharacterInput(input).characterId),
    );
    registerKook(SOCIAL_IPC_CHANNELS.disconnectKookPresence, (input) =>
      kook.disconnect(parseQqCharacterInput(input).characterId),
    );
    registerKook(SOCIAL_IPC_CHANNELS.deleteKookSecret, (input) =>
      kook.deleteSecret(parseQqCharacterInput(input).characterId),
    );
  }

  if (oopzController) {
    const oopz = oopzController;
    const registerOopz = (
      channel: string,
      operation: (input: unknown) => Promise<OopzPresenceSnapshot>,
    ): void =>
      register(
        channel,
        () => oopz.getWindow(),
        OOPZ_PRESENCE_PUBLIC_ERROR,
        parseOopzPresenceSnapshot,
        operation,
      );

    registerOopz(SOCIAL_IPC_CHANNELS.getOopzPresence, (input) => {
      if (input !== undefined) throw new Error(OOPZ_PRESENCE_PUBLIC_ERROR);
      return oopz.getSnapshot();
    });
    registerOopz(SOCIAL_IPC_CHANNELS.saveOopzPresence, (input) =>
      oopz.save(parseOopzSettingsInput(input)),
    );
    // Starting the bridge always re-states the accepted warning; it is never implied by config.
    registerOopz(SOCIAL_IPC_CHANNELS.startOopzBridge, (input) =>
      oopz.startBridge(parseOopzStartInput(input)),
    );
    registerOopz(SOCIAL_IPC_CHANNELS.stopOopzBridge, (input) =>
      oopz.stopBridge(parseQqCharacterInput(input).characterId),
    );
    registerOopz(SOCIAL_IPC_CHANNELS.connectOopzPresence, (input) =>
      oopz.connect(parseQqCharacterInput(input).characterId),
    );
    registerOopz(SOCIAL_IPC_CHANNELS.disconnectOopzPresence, (input) =>
      oopz.disconnect(parseQqCharacterInput(input).characterId),
    );
    registerOopz(SOCIAL_IPC_CHANNELS.deleteOopzSecret, (input) =>
      oopz.deleteSecret(parseQqCharacterInput(input).characterId),
    );
  }

  return () => {
    for (const channel of registered) ipcMain.removeHandler(channel);
  };
};
