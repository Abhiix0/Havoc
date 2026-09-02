import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildErrorDedupKey,
  shouldEmitError,
  activateRuntimeErrorCapture,
  deactivateRuntimeErrorCapture,
} from '../runtime-error-capture';

describe('Runtime Error Capture Dedup & Throttling', () => {
  beforeEach(() => {
    deactivateRuntimeErrorCapture();
    activateRuntimeErrorCapture();
  });

  it('builds stable dedup keys from type, message, filename, lineno', () => {
    const key1 = buildErrorDedupKey(
      'uncaught_exception',
      'Cannot read property of undefined',
      'https://example.com/app.js',
      42
    );
    const key2 = buildErrorDedupKey(
      'uncaught_exception',
      'Cannot read property of undefined',
      'https://example.com/app.js',
      42
    );
    const key3 = buildErrorDedupKey(
      'uncaught_exception',
      'Cannot read property of undefined',
      'https://example.com/app.js',
      43
    );

    expect(key1).toBe('uncaught_exception:Cannot read property of undefined:https://example.com/app.js:42');
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });

  it('suppresses duplicate errors occurring within the 2000ms window', () => {
    const key = buildErrorDedupKey('uncaught_exception', 'Duplicate Error', 'app.js', 10);
    const t0 = 1000;

    // First occurrence -> emit
    expect(shouldEmitError(key, t0)).toBe(true);

    // Second occurrence at t0 + 500ms (within 2000ms) -> suppressed
    expect(shouldEmitError(key, t0 + 500)).toBe(false);

    // Third occurrence at t0 + 1999ms (within 2000ms) -> suppressed
    expect(shouldEmitError(key, t0 + 1999)).toBe(false);

    // Fourth occurrence at t0 + 2001ms (after 2000ms window) -> emit again
    expect(shouldEmitError(key, t0 + 2001)).toBe(true);

    // Fifth occurrence at t0 + 2500ms -> suppressed
    expect(shouldEmitError(key, t0 + 2500)).toBe(false);
  });

  it('emits different error keys independently', () => {
    const keyA = buildErrorDedupKey('uncaught_exception', 'Error A', 'app.js', 10);
    const keyB = buildErrorDedupKey('uncaught_exception', 'Error B', 'app.js', 20);
    const t0 = 1000;

    expect(shouldEmitError(keyA, t0)).toBe(true);
    expect(shouldEmitError(keyB, t0 + 100)).toBe(true);
    expect(shouldEmitError(keyA, t0 + 200)).toBe(false);
    expect(shouldEmitError(keyB, t0 + 300)).toBe(false);
  });

  it('enforces hard cap of 50 total emitted errors per activation lifetime', () => {
    const t0 = 1000;

    // Emit 50 distinct errors
    for (let i = 0; i < 50; i++) {
      const key = buildErrorDedupKey('uncaught_exception', `Error #${i}`, 'app.js', i);
      expect(shouldEmitError(key, t0)).toBe(true);
    }

    // 51st distinct error should be blocked by cap
    const key51 = buildErrorDedupKey('uncaught_exception', 'Error #51', 'app.js', 51);
    expect(shouldEmitError(key51, t0)).toBe(false);

    // 52nd error also blocked
    const key52 = buildErrorDedupKey('unhandled_rejection', 'Rejection #52', '', 0);
    expect(shouldEmitError(key52, t0 + 3000)).toBe(false);

    // Resetting capture clears the counter and allows emitting again
    deactivateRuntimeErrorCapture();
    activateRuntimeErrorCapture();

    expect(shouldEmitError(key51, t0 + 4000)).toBe(true);
  });
});
