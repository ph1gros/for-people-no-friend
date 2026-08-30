import { describe, expect, it } from 'vitest';

import {
  MAX_DROPPED_WORKSPACE_FILE_BYTES,
  parseImportDroppedWorkspaceFilesInput,
  parseResolveAssistantToolApprovalInput,
} from '../src/shared/assistant-tools-ipc';

describe('assistant tool IPC validation', () => {
  it('accepts one bounded approval decision and rejects forged identifiers', () => {
    expect(
      parseResolveAssistantToolApprovalInput({
        requestId: 'chat_1',
        approvalId: 'write_1',
        approved: true,
      }),
    ).toEqual({ requestId: 'chat_1', approvalId: 'write_1', approved: true });
    expect(() =>
      parseResolveAssistantToolApprovalInput({
        requestId: '../chat',
        approvalId: 'write_1',
        approved: true,
      }),
    ).toThrow();
    expect(() =>
      parseResolveAssistantToolApprovalInput({
        requestId: 'chat_1',
        approvalId: 'write_1',
        approved: 'yes',
      }),
    ).toThrow();
  });

  it('accepts bounded dropped bytes and rejects oversized or forged payloads', () => {
    const file = { name: 'notes.txt', bytes: new Uint8Array([1, 2, 3]) };
    expect(parseImportDroppedWorkspaceFilesInput({ assistantMode: true, files: [file] })).toEqual({
      assistantMode: true,
      files: [file],
    });
    expect(
      parseImportDroppedWorkspaceFilesInput({
        assistantMode: true,
        files: [{ name: 'empty.txt', bytes: new Uint8Array() }],
      }).files[0]?.bytes,
    ).toHaveLength(0);
    expect(() =>
      parseImportDroppedWorkspaceFilesInput({
        assistantMode: true,
        files: [{ name: 'large.bin', bytes: new Uint8Array(MAX_DROPPED_WORKSPACE_FILE_BYTES + 1) }],
      }),
    ).toThrow();
    expect(() =>
      parseImportDroppedWorkspaceFilesInput({
        assistantMode: true,
        files: [{ name: 'fake.txt', bytes: [1, 2, 3] }],
      }),
    ).toThrow();
  });
});
