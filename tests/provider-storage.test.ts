import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SecretStore, type SecretEncryption } from '../src/main/security/secret-store';
import { ProviderConfigStore } from '../src/main/storage/provider-config-store';

class FakeEncryption implements SecretEncryption {
  public async isAsyncEncryptionAvailable(): Promise<boolean> {
    return true;
  }

  public async encryptStringAsync(plainText: string): Promise<Buffer> {
    return Buffer.from([...Buffer.from(plainText, 'utf8')].map((byte) => byte ^ 0x5a));
  }

  public async decryptStringAsync(
    encrypted: Buffer,
  ): Promise<{ result: string; shouldReEncrypt: boolean }> {
    return {
      result: Buffer.from([...encrypted].map((byte) => byte ^ 0x5a)).toString('utf8'),
      shouldReEncrypt: false,
    };
  }
}

describe('local provider storage', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it('stores only encrypted secret bytes and never returns secrets through status', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-secret-test-'));
    const store = new SecretStore(directory, new FakeEncryption());

    await store.set('anthropic', 'fake-private-value');

    expect(await store.has('anthropic')).toBe(true);
    expect(await store.get('anthropic')).toBe('fake-private-value');
    const disk = await readFile(path.join(directory, 'secrets.v1.json'), 'utf8');
    expect(disk).not.toContain('fake-private-value');

    await store.delete('anthropic');
    expect(await store.has('anthropic')).toBe(false);
  });

  it('rejects empty and masked secret updates', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-secret-test-'));
    const store = new SecretStore(directory, new FakeEncryption());

    await expect(store.set('anthropic', '')).rejects.toThrow(/unmasked/);
    await expect(store.set('anthropic', '********')).rejects.toThrow(/unmasked/);
  });

  it('serializes concurrent secret writes without losing entries', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-secret-test-'));
    const store = new SecretStore(directory, new FakeEncryption());

    await Promise.all(
      Array.from({ length: 5 }, (_, index) => store.set(`provider-${index}`, `fake-${index}`)),
    );

    await expect(
      Promise.all(Array.from({ length: 5 }, (_, index) => store.get(`provider-${index}`))),
    ).resolves.toEqual(['fake-0', 'fake-1', 'fake-2', 'fake-3', 'fake-4']);
  });

  it('serializes interleaved writes and deletes in call order', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-secret-test-'));
    const store = new SecretStore(directory, new FakeEncryption());

    await Promise.all([
      store.set('provider-a', 'first'),
      store.delete('provider-a'),
      store.set('provider-b', 'second'),
    ]);

    await expect(store.get('provider-a')).resolves.toBeUndefined();
    await expect(store.get('provider-b')).resolves.toBe('second');
  });

  it('skips a malformed entry while preserving valid encrypted secrets', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-secret-test-'));
    const encryption = new FakeEncryption();
    const diagnostics: string[] = [];
    await writeFile(
      path.join(directory, 'secrets.v1.json'),
      JSON.stringify({
        version: 1,
        secrets: {
          anthropic: (await encryption.encryptStringAsync('fake-valid')).toString('base64'),
          '../unsafe-id': 'not base64',
        },
      }),
      'utf8',
    );
    const store = new SecretStore(directory, encryption, (event) => diagnostics.push(event));

    await expect(store.get('anthropic')).resolves.toBe('fake-valid');
    expect(diagnostics).toEqual(['secret-store-invalid-entry-skipped']);
    expect(diagnostics.join('\n')).not.toContain('unsafe-id');
  });

  it('still rejects a secret store whose document is not valid JSON', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-secret-test-'));
    await writeFile(path.join(directory, 'secrets.v1.json'), '{not-json', 'utf8');
    const store = new SecretStore(directory, new FakeEncryption());

    await expect(store.has('anthropic')).rejects.toThrow();
  });

  it('persists only validated non-secret provider configuration', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'deskpet-config-test-'));
    const store = new ProviderConfigStore(directory);

    expect(await store.getOpenAICompatibleBaseUrl()).toBe('https://api.openai.com/v1');
    await Promise.all([
      store.setOpenAICompatibleBaseUrl('http://127.0.0.1:11434/v1'),
      store.setConversationSelection({
        providerId: 'openai-compatible',
        modelId: 'fake-local',
      }),
    ]);
    expect(await store.getOpenAICompatibleBaseUrl()).toBe('http://127.0.0.1:11434/v1');
    expect(await store.getConversationSelection()).toEqual({
      providerId: 'openai-compatible',
      modelId: 'fake-local',
    });
    await store.setProviderConfiguration({
      openAICompatibleBaseUrl: 'http://127.0.0.1:11434/v1',
      allowRemoteComplexTasks: true,
      remoteSelection: { providerId: 'anthropic', modelId: 'fake-remote' },
    });
    expect(await new ProviderConfigStore(directory).getProviderConfiguration()).toEqual({
      openAICompatibleBaseUrl: 'http://127.0.0.1:11434/v1',
      allowRemoteComplexTasks: true,
      remoteSelection: { providerId: 'anthropic', modelId: 'fake-remote' },
    });
    expect(await store.getOpenAICompatibleBaseUrl()).toBe('http://127.0.0.1:11434/v1');
    await expect(store.setOpenAICompatibleBaseUrl('http://remote.example/v1')).rejects.toThrow(
      /HTTPS/,
    );
  });
});
