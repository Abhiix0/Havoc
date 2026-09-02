/**
 * redact.ts — redaction utility for sensitive values.
 *
 * Exposes first 4 and last 4 characters for identification, masking the middle.
 * Short values (<= 8 chars) are fully masked.
 */

export function redactMatch(raw: string): string {
  if (raw.length <= 8) return '[REDACTED]';
  return `${raw.slice(0, 4)}...[REDACTED]...${raw.slice(-4)}`;
}
