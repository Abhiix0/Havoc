import { describe, it, expect } from 'vitest';
import { scanForSecrets, SECRET_PATTERNS } from '../secret-patterns';

describe('Secret Patterns & Scanner', () => {
  it('defines 8 bounded secret patterns with valid metadata', () => {
    expect(SECRET_PATTERNS).toHaveLength(8);
    for (const pattern of SECRET_PATTERNS) {
      expect(pattern.id).toBeTruthy();
      expect(pattern.label).toBeTruthy();
      expect(pattern.regex).toBeInstanceOf(RegExp);
      expect(['HIGH', 'MEDIUM']).toContain(pattern.severity);
    }
  });

  it('matches canonical examples for each pattern and rejects near misses', () => {
    // 1. aws_access_key
    const awsMatch = scanForSecrets('const awsKey = "AKIA1234567890ABCDEF";');
    expect(awsMatch.some((m) => m.patternId === 'aws_access_key')).toBe(true);
    const awsMiss = scanForSecrets('const text = "AKIA123"; const lower = "akia1234567890abcdef";');
    expect(awsMiss.some((m) => m.patternId === 'aws_access_key')).toBe(false);

    // 2. private_key_marker
    const privMatch = scanForSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...');
    expect(privMatch.some((m) => m.patternId === 'private_key_marker')).toBe(true);
    const privMiss = scanForSecrets('// please do not share your private key with anyone');
    expect(privMiss.some((m) => m.patternId === 'private_key_marker')).toBe(false);

    // 3. stripe_key
    const stripeMatch = scanForSecrets('const stripe = Stripe("sk_live_1234567890abcdef1234");');
    expect(stripeMatch.some((m) => m.patternId === 'stripe_key')).toBe(true);
    const stripeMiss = scanForSecrets('const keyType = "sk_live_short";');
    expect(stripeMiss.some((m) => m.patternId === 'stripe_key')).toBe(false);

    // 4. slack_token
    const slackMatch = scanForSecrets('const token = "xoxb-1234567890-abcdefghij";');
    expect(slackMatch.some((m) => m.patternId === 'slack_token')).toBe(true);
    const slackMiss = scanForSecrets('const str = "xoxz-invalid-slack-prefix";');
    expect(slackMiss.some((m) => m.patternId === 'slack_token')).toBe(false);

    // 5. google_api_key (AIza + 35 chars = 39 total)
    const googleMatch = scanForSecrets('const gkey = "AIzaSyD-1234567890abcdef1234567890abcde";');
    expect(googleMatch.some((m) => m.patternId === 'google_api_key')).toBe(true);
    const googleMiss = scanForSecrets('const gkeyShort = "AIzaShortKey";');
    expect(googleMiss.some((m) => m.patternId === 'google_api_key')).toBe(false);

    // 6. bearer_token
    const bearerMatch = scanForSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(bearerMatch.some((m) => m.patternId === 'bearer_token')).toBe(true);
    const bearerMiss = scanForSecrets('const role = "Bearer of bad news";');
    expect(bearerMiss.some((m) => m.patternId === 'bearer_token')).toBe(false);

    // 7. generic_api_key
    const genericApiKeyMatch = scanForSecrets('const api_key = "abc123def456ghi789";');
    expect(genericApiKeyMatch.some((m) => m.patternId === 'generic_api_key')).toBe(true);
    const genericApiKeyMiss = scanForSecrets('// this variable stores the api key format documentation');
    expect(genericApiKeyMiss.some((m) => m.patternId === 'generic_api_key')).toBe(false);

    // 8. generic_secret_assignment
    const genericSecretMatch = scanForSecrets('password = "SuperSecretPassword123"');
    expect(genericSecretMatch.some((m) => m.patternId === 'generic_secret_assignment')).toBe(true);
    const genericSecretMiss = scanForSecrets('const hint = "password must be at least 8 characters";');
    expect(genericSecretMiss.some((m) => m.patternId === 'generic_secret_assignment')).toBe(false);
  });

  it('caps matches returned at 200 total', () => {
    // Generate 300 repetitions of AWS key pattern with exact 16-char suffix
    let payload = '';
    for (let i = 0; i < 300; i++) {
      const suffix = String(i).padStart(16, '0');
      payload += `AKIA${suffix}\n`;
    }

    const matches = scanForSecrets(payload);
    expect(matches).toHaveLength(200);
  });
});
