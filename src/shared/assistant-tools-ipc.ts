export interface AssistantToolStatus {
  workspaceConfigured: boolean;
  workspaceName?: string;
  webAvailable: boolean;
}

export interface AssistantWorkspaceResult extends AssistantToolStatus {
  canceled: boolean;
}

export interface ResolveAssistantToolApprovalInput {
  requestId: string;
  approvalId: string;
  approved: boolean;
}

export const MAX_DROPPED_WORKSPACE_FILES = 16;
export const MAX_DROPPED_WORKSPACE_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_DROPPED_WORKSPACE_TOTAL_BYTES = 64 * 1024 * 1024;

export interface DroppedWorkspaceFile {
  name: string;
  bytes: Uint8Array;
}

export interface ImportDroppedWorkspaceFilesInput {
  assistantMode: boolean;
  files: DroppedWorkspaceFile[];
}

export interface ImportDroppedWorkspaceFilesResult {
  ok: boolean;
  imported: string[];
  message: string;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/u;

export const parseResolveAssistantToolApprovalInput = (
  value: unknown,
): ResolveAssistantToolApprovalInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The assistant approval is invalid.');
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.requestId !== 'string' ||
    !SAFE_ID.test(input.requestId) ||
    typeof input.approvalId !== 'string' ||
    !SAFE_ID.test(input.approvalId) ||
    typeof input.approved !== 'boolean'
  ) {
    throw new Error('The assistant approval is invalid.');
  }
  return {
    requestId: input.requestId,
    approvalId: input.approvalId,
    approved: input.approved,
  };
};

export const parseImportDroppedWorkspaceFilesInput = (
  value: unknown,
): ImportDroppedWorkspaceFilesInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The dropped workspace files are invalid.');
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.assistantMode !== 'boolean' ||
    !Array.isArray(input.files) ||
    input.files.length === 0 ||
    input.files.length > MAX_DROPPED_WORKSPACE_FILES
  ) {
    throw new Error('The dropped workspace files are invalid.');
  }
  let totalBytes = 0;
  const files = input.files.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('The dropped workspace file is invalid.');
    }
    const file = candidate as Record<string, unknown>;
    if (
      typeof file.name !== 'string' ||
      file.name.length === 0 ||
      file.name.length > 255 ||
      !(file.bytes instanceof Uint8Array) ||
      file.bytes.byteLength > MAX_DROPPED_WORKSPACE_FILE_BYTES
    ) {
      throw new Error('The dropped workspace file is invalid.');
    }
    totalBytes += file.bytes.byteLength;
    return { name: file.name, bytes: file.bytes };
  });
  if (totalBytes > MAX_DROPPED_WORKSPACE_TOTAL_BYTES) {
    throw new Error('The dropped workspace files are too large.');
  }
  return { assistantMode: input.assistantMode, files };
};
