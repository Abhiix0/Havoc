/**
 * secret-patterns.ts — regex definitions and scanner for detecting potential
 * secret leaks in client-accessible script content.
 *
 * All regexes are bounded to prevent catastrophic backtracking.
 */

export interface SecretPattern {
  id: string;
  label: string;
  regex: RegExp;
  severity: 'HIGH' | 'MEDIUM';
}

export const SECRET_PATTERNS: SecretPattern[] = [
  {
    id: 'aws_access_key',
    label: 'AWS Access Key',
    regex: /AKIA[0-9A-Z]{16}/g,
    severity: 'HIGH',
  },
  {
    id: 'private_key_marker',
    label: 'Private Key Marker',
    regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    severity: 'HIGH',
  },
  {
    id: 'stripe_key',
    label: 'Stripe API Key',
    regex: /\b(sk|pk)_(live|test)_[0-9a-zA-Z]{16,}\b/g,
    severity: 'HIGH',
  },
  {
    id: 'slack_token',
    label: 'Slack Token',
    regex: /\bxox[baprs]-[0-9a-zA-Z-]{10,}\b/g,
    severity: 'HIGH',
  },
  {
    id: 'google_api_key',
    label: 'Google API Key',
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
    severity: 'HIGH',
  },
  {
    id: 'bearer_token',
    label: 'Bearer Token',
    regex: /\bBearer\s+[A-Za-z0-9\-_.]{20,}\b/g,
    severity: 'MEDIUM',
  },
  {
    id: 'generic_api_key',
    label: 'Generic API Key Assignment',
    regex: /\b(api[_-]?key|apikey)\s*[:=]\s*['"][a-zA-Z0-9_\-]{16,}['"]/gi,
    severity: 'MEDIUM',
  },
  {
    id: 'generic_secret_assignment',
    label: 'Generic Secret Assignment',
    regex: /\b(secret|token|password)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    severity: 'MEDIUM',
  },
];

export interface SecretMatch {
  patternId: string;
  label: string;
  severity: 'HIGH' | 'MEDIUM';
  rawMatch: string;
}

/**
 * Scan raw text against all secret patterns.
 * Returns raw matches up to a combined cap of 200.
 * Redaction is performed by the caller.
 */
export function scanForSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const MAX_MATCHES = 200;

  for (const pattern of SECRET_PATTERNS) {
    if (matches.length >= MAX_MATCHES) break;

    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      matches.push({
        patternId: pattern.id,
        label: pattern.label,
        severity: pattern.severity,
        rawMatch: match[0],
      });

      if (matches.length >= MAX_MATCHES) {
        break;
      }

      // Avoid infinite loop if regex matches zero-length
      if (match.index === regex.lastIndex) {
        regex.lastIndex++;
      }
    }
  }

  return matches;
}
