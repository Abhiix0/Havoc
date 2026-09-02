import { describe, it, expect } from 'vitest';
import { redactMatch } from '../redact';

describe('Redaction Utility', () => {
  it('redacts a 20-character key with first 4, last 4, and [REDACTED], without leaking full raw key', () => {
    const rawKey = '1234567890abcdefghij';
    const redacted = redactMatch(rawKey);

    expect(redacted).toBe('1234...[REDACTED]...ghij');
    expect(redacted).toContain('1234');
    expect(redacted).toContain('ghij');
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).not.toContain(rawKey);
  });

  it('completely masks short strings (<= 8 characters) with zero exposed raw characters', () => {
    const shortRaw = 'secret';
    const redacted = redactMatch(shortRaw);

    expect(redacted).toBe('[REDACTED]');
    expect(redacted).not.toContain('sec');
    expect(redacted).not.toContain('ret');

    const exact8 = '12345678';
    expect(redactMatch(exact8)).toBe('[REDACTED]');
  });
});
