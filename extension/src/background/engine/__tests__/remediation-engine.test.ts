import { describe, it, expect } from 'vitest';
import { deriveRemediation } from '../remediation-engine';
import type { Finding } from '../../../domain/finding';
import type { HavocEvent } from '../../../domain/event';

describe('Remediation Engine', () => {
  const runId = 'run-rem-123';

  it('generates specific remediation and fixPrompt for fetch_failure (FAILED outcome)', () => {
    const finding: Finding = {
      id: 'f-fetch-fail',
      runId,
      severity: 'HIGH',
      confidence: 0.95,
      description: 'Application did not recover after chaos injection.',
      evidenceIds: ['ev-1'],
      checkKind: 'fetch_failure',
    };

    const failEvent: HavocEvent = {
      id: 'ev-1',
      runId,
      timestamp: 1000,
      sequence: 1,
      type: 'REQUEST_HTTP_FAILURE',
      source: 'page',
      resource: 'https://api.example.com/checkout',
      metadata: { status: 503 },
    };

    const remediation = deriveRemediation(finding, {
      events: [failEvent],
      signals: [],
      recoveryOutcome: 'FAILED',
    });

    expect(remediation.findingId).toBe(finding.id);
    expect(remediation.runId).toBe(finding.runId);
    expect(remediation.title).toContain("doesn't handle API failures");
    expect(remediation.howToFix.length).toBeGreaterThanOrEqual(3);
    expect(remediation.fixPrompt).toContain('Fix the API error handling');
    expect(remediation.fixPrompt).toContain('https://api.example.com/checkout');
    expect(remediation.fixPrompt).toContain('status 503');
    expect(remediation.fixPrompt).not.toContain('[evidence bullet');
  });

  it('generates retry and fallback remediation for fetch_latency (DEGRADED outcome)', () => {
    const finding: Finding = {
      id: 'f-fetch-lat',
      runId,
      severity: 'MEDIUM',
      confidence: 0.85,
      description: 'Application entered an error state after chaos injection and degraded.',
      evidenceIds: ['ev-2'],
      checkKind: 'fetch_latency',
    };

    const remediation = deriveRemediation(finding, {
      events: [],
      signals: [],
      recoveryOutcome: 'DEGRADED',
    });

    expect(remediation.title).toContain('retry and recovery');
    expect(remediation.fixPrompt).toContain('recovery and retry flow');
    expect(remediation.fixPrompt).toContain('HAVOC observed:');
  });

  it('generates form validation remediation for input_stress', () => {
    const finding: Finding = {
      id: 'f-input-stress',
      runId,
      severity: 'MEDIUM',
      confidence: 0.90,
      description: 'Form input stress injection caused unexpected state.',
      evidenceIds: [],
      checkKind: 'input_stress',
    };

    const remediation = deriveRemediation(finding, {
      events: [],
      signals: [],
    });

    expect(remediation.title).toContain('forms');
    expect(remediation.fixPrompt).toContain('form input validation and sanitization');
  });

  it('generates responsive layout remediation for viewport_stress without fabricating data', () => {
    const finding: Finding = {
      id: 'f-viewport',
      runId,
      severity: 'MEDIUM',
      confidence: 0.80,
      description: 'Viewport stress testing revealed layout constraints.',
      evidenceIds: [],
      checkKind: 'viewport_stress',
    };

    const remediation = deriveRemediation(finding, {
      events: [],
      signals: [],
    });

    expect(remediation.title).toContain('layout');
    expect(remediation.fixPrompt).toContain('responsive layout and overflow handling');
  });

  it('generates runtime error remediation containing real captured error messages and filenames', () => {
    const finding: Finding = {
      id: 'f-runtime-err',
      runId,
      severity: 'HIGH',
      confidence: 0.98,
      description: 'Observed runtime errors on page.',
      evidenceIds: ['ev-err-1'],
      checkKind: 'runtime_errors',
    };

    const errorEvent: HavocEvent = {
      id: 'ev-err-1',
      runId,
      timestamp: 1000,
      sequence: 1,
      type: 'UNCAUGHT_EXCEPTION',
      source: 'page',
      metadata: {
        message: 'TypeError: Cannot read property "name" of undefined',
        filename: 'https://example.com/assets/app.js',
        lineno: 142,
      },
    };

    const remediation = deriveRemediation(finding, {
      events: [errorEvent],
      signals: [],
    });

    expect(remediation.title).toContain('JavaScript errors');
    expect(remediation.whatHappened).toContain('TypeError: Cannot read property "name" of undefined');
    expect(remediation.fixPrompt).toContain('https://example.com/assets/app.js:142');
    expect(remediation.fixPrompt).toContain('TypeError: Cannot read property "name" of undefined');
  });

  it('generates secret scan remediation referencing pattern label and sourceDescription without raw secret exposure', () => {
    const finding: Finding = {
      id: 'f-secret',
      runId,
      severity: 'HIGH',
      confidence: 0.60,
      description: 'Observed potential secret matches in scripts.',
      evidenceIds: ['ev-sec-1'],
      checkKind: 'secret_scan',
    };

    const secretEvent: HavocEvent = {
      id: 'ev-sec-1',
      runId,
      timestamp: 1000,
      sequence: 1,
      type: 'SECRET_PATTERN_MATCH',
      source: 'service_worker',
      metadata: {
        patternId: 'aws_access_key',
        label: 'AWS Access Key',
        severity: 'HIGH',
        redacted: 'AKIA...[REDACTED]...1234',
        sourceDescription: 'external script: https://example.com/bundle.js',
      },
    };

    const remediation = deriveRemediation(finding, {
      events: [secretEvent],
      signals: [],
    });

    expect(remediation.title).toContain('Exposed API keys or secrets');
    expect(remediation.fixPrompt).toContain('AWS Access Key');
    expect(remediation.fixPrompt).toContain('external script: https://example.com/bundle.js');
    expect(remediation.fixPrompt).toContain('Rotate the exposed credential immediately');
    // Ensure no unredacted secret is presented
    expect(remediation.fixPrompt).not.toContain('AKIAFAKE');
  });

  it('falls back safely for undefined or unrecognized checkKind without throwing', () => {
    const finding: Finding = {
      id: 'f-unknown',
      runId,
      severity: 'LOW',
      confidence: 0.50,
      description: 'Generic custom resilience observation.',
      evidenceIds: [],
    };

    const remediation = deriveRemediation(finding, {
      events: [],
      signals: [],
    });

    expect(remediation).toBeDefined();
    expect(remediation.findingId).toBe(finding.id);
    expect(remediation.whatHappened).toBe('Generic custom resilience observation.');
    expect(remediation.fixPrompt).toContain('Generic custom resilience observation.');
  });
});
