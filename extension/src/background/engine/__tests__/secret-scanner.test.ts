import { describe, it, expect, beforeEach, vi } from 'vitest';
import { secretScannerExecutor } from '../secret-scanner';
import type { Target } from '../../../domain/target';
import type { PassiveCheckDefinition } from '../../../domain/passive-check';

describe('Secret Scanner Executor', () => {
  const target: Target = {
    tabId: 101,
    origin: 'https://example.com',
    url: 'https://example.com/app',
    frameId: 0,
  };

  const definition: PassiveCheckDefinition = {
    id: 'check-secret-scan',
    kind: 'secret_scan',
    name: 'Secret Exposure Check',
    description: 'Scan page scripts for sensitive token patterns',
    params: {},
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('scans script chunks, returns SECRET_PATTERN_MATCH event with redacted value, and NEVER leaks raw secret in event payload', async () => {
    const rawFakeKey = 'AKIAFAKEFAKEFAKE1234';

    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: vi.fn().mockResolvedValue([
          {
            result: [
              {
                sourceDescription: 'inline <script> tag',
                text: `const config = { awsKey: "${rawFakeKey}" };`,
              },
            ],
          },
        ]),
      },
    });

    let seq = 0;
    const { events } = await secretScannerExecutor(
      target,
      definition,
      'run-sec-1',
      () => ++seq
    );

    // (a) exactly one SECRET_PATTERN_MATCH event returned
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('SECRET_PATTERN_MATCH');
    expect(events[0]?.metadata?.patternId).toBe('aws_access_key');
    expect(events[0]?.metadata?.label).toBe('AWS Access Key');
    expect(events[0]?.metadata?.severity).toBe('HIGH');

    // (b) JSON.stringify(events) does NOT contain the raw key substring
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(rawFakeKey);

    // (c) contains the redacted form
    expect(events[0]?.metadata?.redacted).toBe('AKIA...[REDACTED]...1234');
    expect(serialized).toContain('AKIA...[REDACTED]...1234');
  });

  it('enforces 200 event cap across multiple matches', async () => {
    // Generate 300 unique keys in the script with distinct last 4 characters
    let largeScript = '';
    for (let i = 0; i < 300; i++) {
      const suffix = String(i).padStart(16, '0');
      largeScript += `const key${i} = "AKIA${suffix}";\n`;
    }

    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: vi.fn().mockResolvedValue([
          {
            result: [
              {
                sourceDescription: 'external script: https://example.com/bundle.js?token=secret123',
                text: largeScript,
              },
            ],
          },
        ]),
      },
    });

    let seq = 0;
    const { events } = await secretScannerExecutor(
      target,
      definition,
      'run-sec-cap',
      () => ++seq
    );

    expect(events).toHaveLength(200);
    // Also verify external script URL was sanitized
    expect(events[0]?.metadata?.sourceDescription).toBe(
      'external script: https://example.com/bundle.js?token=[REDACTED]'
    );
  });

  it('handles executeScript errors gracefully by returning 0 events', async () => {
    vi.stubGlobal('chrome', {
      scripting: {
        executeScript: vi.fn().mockRejectedValue(new Error('Cannot access tab')),
      },
    });

    let seq = 0;
    const { events } = await secretScannerExecutor(
      target,
      definition,
      'run-sec-err',
      () => ++seq
    );

    expect(events).toEqual([]);
  });
});
