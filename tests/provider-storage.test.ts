import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
    expect(await store.getOpenAICompatibleBaseUrl()).toBe('http://127.0.0.1:11434/v1');
    await expect(store.setOpenAICompatibleBaseUrl('http://remote.example/v1')).rejects.toThrow(
      /HTTPS/,
    );
  });
});
