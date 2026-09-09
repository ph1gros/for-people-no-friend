const REDACTED = '[redacted]';

const SECRET_PATTERNS: readonly RegExp[] = [
  // Authorization / Bot headers, including the KOOK `Bot <token>` form.
  /\b(authorization|x-api-key|api[-_]?key|token|secret|password)\b\s*[:=]\s*"?[^\s",;]{6,}"?/gi,
  /\bBot\s+[A-Za-z0-9._~+/-]{12,}=*/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/g,
  // Opaque credential-shaped blobs (QQ app secrets, KOOK bot tokens, base64 payloads).
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
  /\b(?:sk|api|key)-[A-Za-z0-9_-]{12,}\b/gi,
];

/**
 * Removes credential-shaped substrings before a value reaches a log line, a diagnostics report
 * or an error surfaced to the renderer. Redaction is deliberately eager: a false positive costs
 * readability, a false negative leaks a bot token.
 */
export const redactSocialSecrets = (value: string): string => {
  let result = value;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
};

/** Formats an unknown thrown value as a redacted, length-bounded message. */
export const describeSocialError = (error: unknown, maximumLength = 300): string => {
  const raw =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error.';
  return redactSocialSecrets(raw).slice(0, maximumLength);
};

/** Renders a stored secret for display. The real value never leaves the main process. */
export const maskSocialSecret = (value: string): string =>
  value.length === 0 ? '' : '*'.repeat(Math.min(24, Math.max(8, value.length)));
