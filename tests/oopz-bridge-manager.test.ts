import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OopzBridgeManager,
  oopzCredentialId,
  type OopzManagedRuntime,
} from '../src/main/social/oopz-bridge-manager';
import {
  OOPZ_BRIDGE_ERROR,
  parseOopzBridgeSave,
  parseOopzBridgeStart,
} from '../src/shared/oopz-bridge';

const input = { characterId: 'character-a', acceptedWarningVersion: 1 as const };
const credentials = { ...input, account: '15555550123', password: ' fake-test-password ' };
const managers: OopzBridgeManager[] = [];
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.dispose();
});

function setup(runtimeOverride?: OopzManagedRuntime | null) {
  let active = input.characterId;
  let autoSpawn = true;
  let closes = true;
  let child: ChildProcess;
  const secrets = new Map<string, string>();
  const store = {
    get: vi.fn(async (id: string) => secrets.get(id)),
    has: vi.fn(async (id: string) => secrets.has(id)),
    set: vi.fn(async (id: string, value: string) => {
      secrets.set(id, value);
    }),
    delete: vi.fn(async (id: string) => {
      secrets.delete(id);
    }),
  };
  const runtime = {
    launch: vi.fn<(environment: NodeJS.ProcessEnv) => ChildProcess>(() => {
      const fake = new EventEmitter();
      Object.assign(fake, {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        stdin: new PassThrough(),
      });
      child = fake as ChildProcess;
      if (autoSpawn) queueMicrotask(() => child.emit('spawn'));
      return child;
    }),
    terminate: vi.fn(async (target: ChildProcess, force: boolean) => {
      if (closes || force) target.emit('close', 0, null);
    }),
  };
  const manager = new OopzBridgeManager({
    secrets: store,
    getActiveCharacterId: async () => active,
    runtime: runtimeOverride === null ? undefined : (runtimeOverride ?? runtime),
    startupTimeoutMs: 30,
    shutdownTimeoutMs: 20,
  });
  managers.push(manager);
  return {
    manager,
    runtime,
    store,
    secrets,
    child: () => child,
    change: () => {
      active = 'character-b';
    },
    noSpawn: () => {
      autoSpawn = false;
    },
    forceOnly: () => {
      closes = false;
    },
  };
}

describe('Oopz experimental bridge management', () => {
  it('adopts and terminates a child even when launch reenters stop', async () => {
    const h = setup();
    await h.manager.save(credentials);
    const launch = h.runtime.launch.getMockImplementation()!;
    h.runtime.launch.mockImplementationOnce((environment) => {
      void h.manager.stop();
      return launch(environment);
    });
    await expect(h.manager.start(input)).rejects.toThrow(OOPZ_BRIDGE_ERROR);
    expect(h.runtime.terminate).toHaveBeenCalledWith(h.child(), false);
    expect((await h.manager.snapshot(input.characterId)).state).toBe('stopped');
    await h.manager.start(input);
    expect((await h.manager.snapshot(input.characterId)).state).toBe('running');
  });

  it('keeps an intentional stop during spawn in the stopped state', async () => {
    const h = setup();
    h.noSpawn();
    await h.manager.save(credentials);
    const starting = h.manager.start(input);
    const cancelled = expect(starting).rejects.toThrow(OOPZ_BRIDGE_ERROR);
    // Microtask polling avoids letting the deliberately short startup timer expire.
    while (!h.runtime.launch.mock.calls.length) await Promise.resolve();
    await h.manager.stop();
    await cancelled;
    expect(h.runtime.terminate).toHaveBeenCalled();
    expect((await h.manager.snapshot(input.characterId)).state).toBe('stopped');
  });
  it('requires explicit warning acknowledgement and validates bounded credentials', () => {
    expect(() => parseOopzBridgeStart({ characterId: 'character-a' })).toThrow();
    expect(() => parseOopzBridgeStart({ ...input, acceptedWarningVersion: true })).toThrow();
    expect(() => parseOopzBridgeSave({ ...credentials, password: 'x'.repeat(257) })).toThrow();
    expect(() => parseOopzBridgeSave({ ...credentials, account: 'not-a-phone' })).toThrow();
    expect(() => parseOopzBridgeSave({ ...credentials, password: '*****' })).toThrow();
    expect(parseOopzBridgeSave({ ...credentials, command: 'arbitrary' })).toEqual(credentials);
  });
  it('saves both credentials as one secret, preserves password whitespace, and exposes neither', async () => {
    const h = setup();
    await h.manager.save(credentials);
    expect(JSON.parse(h.secrets.get(oopzCredentialId(input.characterId))!)).toEqual({
      account: credentials.account,
      password: credentials.password,
    });
    const snapshot = await h.manager.snapshot(input.characterId);
    expect(snapshot).toMatchObject({ state: 'stopped', hasCredentials: true, experimental: true });
    expect(JSON.stringify(snapshot)).not.toContain(credentials.account);
    expect(JSON.stringify(snapshot)).not.toContain(credentials.password);
    expect(h.runtime.launch).not.toHaveBeenCalled();
    expect(oopzCredentialId('character-b')).not.toBe(oopzCredentialId('character-a'));
  });
  it('starts only on request, does not duplicate or auto-restart, and drains private output', async () => {
    const h = setup();
    await h.manager.save(credentials);
    await h.manager.start(input);
    await h.manager.start(input);
    expect(h.runtime.launch).toHaveBeenCalledOnce();
    expect(h.runtime.launch.mock.calls[0]![0]).toMatchObject({
      OOPZ_LOGIN_PHONE: credentials.account,
      OOPZ_LOGIN_PASSWORD: credentials.password,
    });
    expect(h.runtime.launch.mock.calls[0]![0]).not.toHaveProperty('PATH');
    h.child().stdout!.emit('data', Buffer.from('fake-private-output'));
    h.child().emit('close', 1, null);
    expect((await h.manager.snapshot(input.characterId)).state).toBe('error');
    expect(h.runtime.launch).toHaveBeenCalledOnce();
  });
  it('escalates termination and deletes the saved credentials after stopping', async () => {
    const h = setup();
    h.forceOnly();
    await h.manager.save(credentials);
    await h.manager.start(input);
    await h.manager.deleteCredentials(input.characterId);
    expect(h.runtime.terminate.mock.calls.map((call) => call[1])).toEqual([false, true]);
    expect((await h.manager.snapshot(input.characterId)).hasCredentials).toBe(false);
  });
  it('times out startup and cleans up without leaking upstream errors', async () => {
    const h = setup();
    h.noSpawn();
    await h.manager.save(credentials);
    await expect(h.manager.start(input)).rejects.toThrow(OOPZ_BRIDGE_ERROR);
    expect(h.runtime.terminate).toHaveBeenCalled();
    expect((await h.manager.snapshot(input.characterId)).state).toBe('error');
  });
  it('invalidates in-flight secret reads on stop, before a process can spawn', async () => {
    const h = setup();
    await h.manager.save(credentials);
    let resolve!: (value: string) => void;
    h.store.get.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = h.manager.start(input);
    const rejected = expect(pending).rejects.toThrow(OOPZ_BRIDGE_ERROR);
    await vi.waitFor(() => expect(h.store.get).toHaveBeenCalled());
    await h.manager.stop();
    resolve(JSON.stringify(credentials));
    await rejected;
    expect(h.runtime.launch).not.toHaveBeenCalled();
    expect((await h.manager.snapshot(input.characterId)).state).toBe('stopped');
  });
  it('fails closed without a runtime and never reads the password', async () => {
    const h = setup(null);
    await h.manager.save(credentials);
    await expect(h.manager.start(input)).rejects.toThrow(OOPZ_BRIDGE_ERROR);
    expect(h.store.get).not.toHaveBeenCalled();
  });
  it('retains ownership if termination fails and refuses another process', async () => {
    const h = setup();
    await h.manager.save(credentials);
    await h.manager.start(input);
    h.runtime.terminate.mockImplementation(async () => {
      throw new Error('fake-sensitive-diagnostic');
    });
    await h.manager.stop();
    expect((await h.manager.snapshot(input.characterId)).state).toBe('error');
    await expect(h.manager.start(input)).rejects.toThrow(OOPZ_BRIDGE_ERROR);
    expect(h.runtime.launch).toHaveBeenCalledOnce();
    h.child().emit('close', 1, null);
  });
  it('redacts secret-store failures and never launches', async () => {
    const h = setup();
    h.store.get.mockRejectedValueOnce(new Error('fake-secret-diagnostic'));
    await expect(h.manager.start(input)).rejects.toThrow(OOPZ_BRIDGE_ERROR);
    expect(h.runtime.launch).not.toHaveBeenCalled();
  });
  it('rejects cross-character operations and stops the old child', async () => {
    const h = setup();
    await h.manager.save(credentials);
    await h.manager.start(input);
    h.change();
    await expect(h.manager.start(input)).rejects.toThrow(OOPZ_BRIDGE_ERROR);
    await h.manager.stop();
    expect(h.runtime.terminate).toHaveBeenCalled();
  });
  it('owns and closes a real local test process without using a shell or network', async () => {
    let launched: ChildProcess | undefined;
    const h = setup({
      launch: (env) =>
        (launched = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
          env,
          shell: false,
          windowsHide: true,
          stdio: 'pipe',
        })),
      terminate: async (child) => {
        child.kill();
      },
    });
    try {
      await h.manager.save(credentials);
      await h.manager.start(input);
      expect(launched?.pid).toBeGreaterThan(0);
      await h.manager.stop();
      expect((await h.manager.snapshot(input.characterId)).state).toBe('stopped');
    } finally {
      launched?.kill();
    }
  });
});
