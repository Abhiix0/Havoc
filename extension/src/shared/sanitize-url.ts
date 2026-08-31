/**
 * sanitize-url.ts — URL query parameter redactor for sensitive telemetry fields.
 *
 * Applies at observation capture time to ensure authentication credentials,
 * tracking IDs, and session tokens are stripped before entering the observation
 * relay, storage, or analysis pipelines.
 */

/**
 * Pattern matching parameter keys that typically contain sensitive data
 * (session tokens, tracking IDs, auth credentials, API keys, passwords).
 */
export const SENSITIVE_PARAM_PATTERN =
  /token|auth|session|sid|uid|key|secret|password|credential/i;

/**
 * Sanitizes a URL string by redacting the values of sensitive query parameters with [REDACTED].
 *
 * Preserves the URL origin, path, non-sensitive parameters, and hash intact.
 * Falls back gracefully to returning the original string if parsing fails.
 *
 * @param url Raw absolute or relative URL string.
 * @returns Sanitized URL string.
 */
export function sanitizeUrl(url: string): string {
  if (typeof url !== 'string' || url.length === 0) {
    return url;
  }

  // Sentinel URLs like '__chaos_injected__'
  if (url === '__chaos_injected__') {
    return url;
  }

  try {
    let isRelative = false;
    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      parsed = new URL(url, 'http://havoc.local');
      isRelative = true;
    }

    if (!parsed.search) {
      return url;
    }

    let modified = false;
    const newParams = new URLSearchParams();
    for (const [key, value] of parsed.searchParams.entries()) {
      if (SENSITIVE_PARAM_PATTERN.test(key)) {
        modified = true;
        newParams.append(key, '[REDACTED]');
      } else {
        newParams.append(key, value);
      }
    }

    if (!modified) {
      return url;
    }

    parsed.search = newParams.toString();

    let resultString: string;
    if (isRelative) {
      const queryAndHash = `${parsed.search}${parsed.hash}`;
      if (url.startsWith('/')) {
        resultString = `${parsed.pathname}${queryAndHash}`;
      } else if (url.startsWith('?')) {
        resultString = `${parsed.search}${parsed.hash}`;
      } else {
        const pathWithoutLeadingSlash = parsed.pathname.replace(/^\//, '');
        resultString = `${pathWithoutLeadingSlash}${queryAndHash}`;
      }
    } else {
      resultString = parsed.toString();
    }

    // Replace URL-encoded %5BREDACTED%5D with literal [REDACTED]
    return resultString.replace(/%5BREDACTED%5D/g, '[REDACTED]');
  } catch {
    return url;
  }
}
