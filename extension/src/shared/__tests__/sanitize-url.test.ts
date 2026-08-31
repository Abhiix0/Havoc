import { describe, it, expect } from 'vitest';
import { sanitizeUrl } from '../sanitize-url';

describe('sanitizeUrl utility', () => {
  describe('Sensitive parameter redaction', () => {
    it('redacts a URL with a sensitive token parameter', () => {
      const url = 'https://example.com/api/user?token=secretToken123';
      expect(sanitizeUrl(url)).toBe('https://example.com/api/user?token=[REDACTED]');
    });

    it('redacts multiple sensitive parameters independently', () => {
      const url =
        'https://example.com/api/v1?token=tok123&auth=bearer_xyz&session=sess99&apiKey=key_abc&secret=sec_def&password=pass123&credential=cred456';
      expect(sanitizeUrl(url)).toBe(
        'https://example.com/api/v1?token=[REDACTED]&auth=[REDACTED]&session=[REDACTED]&apiKey=[REDACTED]&secret=[REDACTED]&password=[REDACTED]&credential=[REDACTED]'
      );
    });

    it('redacts real-world analytics and tracking identifiers (ga_uid, auid, f.sid)', () => {
      const url = 'https://telemetry.example.com/collect?ga_uid=usr_123&auid=a_456&f.sid=s_789&action=click';
      expect(sanitizeUrl(url)).toBe(
        'https://telemetry.example.com/collect?ga_uid=[REDACTED]&auid=[REDACTED]&f.sid=[REDACTED]&action=click'
      );
    });

    it('preserves non-sensitive query parameters while redacting sensitive ones', () => {
      const url = 'https://asos.com/api/search?q=running+shoes&category=footwear&token=tok_abc&page=2&limit=20';
      expect(sanitizeUrl(url)).toBe(
        'https://asos.com/api/search?q=running+shoes&category=footwear&token=[REDACTED]&page=2&limit=20'
      );
    });
  });

  describe('Non-sensitive URLs', () => {
    it('leaves a URL with only non-sensitive query parameters untouched', () => {
      const url = 'https://example.com/products?category=shoes&sort=price_asc&page=2&limit=50';
      expect(sanitizeUrl(url)).toBe(url);
    });

    it('leaves a URL with no query parameters untouched', () => {
      const url = 'https://example.com/checkout/summary';
      expect(sanitizeUrl(url)).toBe(url);
    });

    it('leaves a URL with hash fragment intact', () => {
      const url = 'https://example.com/dashboard?token=xyz123#analytics';
      expect(sanitizeUrl(url)).toBe('https://example.com/dashboard?token=[REDACTED]#analytics');
    });
  });

  describe('Relative URLs & Path formats', () => {
    it('redacts sensitive query params in absolute path relative URLs (/api/...)', () => {
      const url = '/api/user/profile?token=abc123&format=json';
      expect(sanitizeUrl(url)).toBe('/api/user/profile?token=[REDACTED]&format=json');
    });

    it('redacts sensitive query params in relative path URLs (api/...)', () => {
      const url = 'api/items?apiKey=secret_key_1&category=books';
      expect(sanitizeUrl(url)).toBe('api/items?apiKey=[REDACTED]&category=books');
    });

    it('redacts sensitive query params in query-only strings (?token=...)', () => {
      const url = '?session_id=sess_active&tab=history';
      expect(sanitizeUrl(url)).toBe('?session_id=[REDACTED]&tab=history');
    });
  });

  describe('Edge cases and malformed inputs', () => {
    it('returns empty string for empty input without throwing', () => {
      expect(sanitizeUrl('')).toBe('');
    });

    it('returns sentinel string __chaos_injected__ unchanged', () => {
      expect(sanitizeUrl('__chaos_injected__')).toBe('__chaos_injected__');
    });

    it('handles malformed URL strings gracefully without throwing', () => {
      const malformed = '://invalid-uri?token=123';
      expect(() => sanitizeUrl(malformed)).not.toThrow();
      expect(typeof sanitizeUrl(malformed)).toBe('string');
    });

    it('handles null / undefined / non-string gracefully', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(sanitizeUrl(null as any)).toBe(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(sanitizeUrl(undefined as any)).toBe(undefined);
    });
  });
});
