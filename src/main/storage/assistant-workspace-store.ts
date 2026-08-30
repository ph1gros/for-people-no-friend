import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface StoredAssistantWorkspace {
  version: 1;
  root: string;
}

export class AssistantWorkspaceStore {
  private readonly filePath: string;

  public constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'assistant-workspace.v1.json');
  }

  public async getRoot(): Promise<string | undefined> {
    try {
      const value = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
      const record = value as Record<string, unknown>;
      if (
        record.version !== 1 ||
        typeof record.root !== 'string' ||
        !path.isAbsolute(record.root)
      ) {
        return undefined;
      }
      return path.resolve(record.root);
    } catch {
      return undefined;
    }
  }

  public async setRoot(root: string): Promise<void> {
    const resolved = path.resolve(root);
    if (!path.isAbsolute(resolved)) throw new Error('The workspace path is invalid.');
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    const value: StoredAssistantWorkspace = { version: 1, root: resolved };
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}
