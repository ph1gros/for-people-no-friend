import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface SecretEncryption {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(
    encrypted: Buffer,
  ): Promise<{ result: string; shouldReEncrypt: boolean; isTemporarilyUnavailable?: boolean }>;
}

interface SecretFile {
  version: 1;
  secrets: Record<string, string>;
}

const SECRET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_CIPHERTEXT_LENGTH = 131_072;

const emptySecretFile = (): SecretFile => ({ version: 1, secrets: {} });

const parseSecretFile = (text: string): SecretFile => {
  const value = JSON.parse(text) as unknown;
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    value.version !== 1 ||
    !('secrets' in value) ||
    typeof value.secrets !== 'object' ||
    value.secrets === null ||
    Array.isArray(value.secrets)
  ) {
    throw new Error('The encrypted secret store is invalid.');
  }

  const secrets: Record<string, string> = {};
  for (const [id, ciphertext] of Object.entries(value.secrets)) {
    if (
      !SECRET_ID_PATTERN.test(id) ||
      typeof ciphertext !== 'string' ||
      ciphertext.length === 0 ||
      ciphertext.length > MAX_CIPHERTEXT_LENGTH ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)
    ) {
      throw new Error('The encrypted secret store contains an invalid entry.');
    }
    secrets[id] = ciphertext;
  }
  return { version: 1, secrets };
};

export class SecretStore {
  private readonly filePath: string;

  public constructor(
    userDataPath: string,
    private readonly encryption: SecretEncryption,
  ) {
    this.filePath = path.join(userDataPath, 'secrets.v1.json');
  }

  public async has(secretId: string): Promise<boolean> {
    this.validateSecretId(secretId);
    const file = await this.read();
    return secretId in file.secrets;
  }

  public async get(secretId: string): Promise<string | undefined> {
    this.validateSecretId(secretId);
    const file = await this.read();
    const encoded = file.secrets[secretId];
    if (!encoded) {
      return undefined;
    }

    const result = await this.encryption.decryptStringAsync(Buffer.from(encoded, 'base64'));
    if (result.isTemporarilyUnavailable) {
      throw new Error('Secure storage is temporarily unavailable.');
    }
    if (result.shouldReEncrypt) {
      await this.set(secretId, result.result);
    }
    return result.result;
  }

  public async set(secretId: string, value: string): Promise<void> {
    this.validateSecretId(secretId);
    if (
      typeof value !== 'string' ||
      value.trim().length === 0 ||
      value.length > 32_768 ||
      /^\*+$/.test(value.trim())
    ) {
      throw new Error('A non-empty, unmasked secret is required.');
    }
    if (!(await this.encryption.isAsyncEncryptionAvailable())) {
      throw new Error('Operating-system encryption is unavailable.');
    }

    const encrypted = await this.encryption.encryptStringAsync(value.trim());
    const file = await this.read();
    file.secrets[secretId] = encrypted.toString('base64');
    await this.write(file);
  }

  public async delete(secretId: string): Promise<void> {
    this.validateSecretId(secretId);
    const file = await this.read();
    if (!(secretId in file.secrets)) {
      return;
    }
    delete file.secrets[secretId];
    await this.write(file);
  }

  private validateSecretId(secretId: string): void {
    if (!SECRET_ID_PATTERN.test(secretId)) {
      throw new Error('The secret ID is invalid.');
    }
  }

  private async read(): Promise<SecretFile> {
    try {
      return parseSecretFile(await readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return emptySecretFile();
      }
      throw error;
    }
  }

  private async write(file: SecretFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(file, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    try {
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}
