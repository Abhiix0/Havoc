/**
 * runtime-error-capture.ts — captures uncaught exceptions and unhandled promise rejections.
 *
 * Runs in the page world. Off by default; only active during an explicit passive check run.
 */

import { sanitizeUrl } from '../shared/sanitize-url';
import { createRuntimeErrorObservationMessage } from '../messaging/messages';

const DEDUP_WINDOW_MS = 2000;
const MAX_DISTINCT_ERRORS = 50;

let _captureActive = false;
let _totalEmittedCount = 0;
const _dedupMap = new Map<string, { count: number; lastSeen: number }>();

export function buildErrorDedupKey(
  type: string,
  message: string,
  filename: string,
  lineno: number
): string {
  return `${type}:${message}:${filename}:${lineno}`;
}

export function shouldEmitError(
  key: string,
  now: number = Date.now()
): boolean {
  if (_totalEmittedCount >= MAX_DISTINCT_ERRORS) {
    return false;
  }

  const existing = _dedupMap.get(key);
  if (existing) {
    if (now - existing.lastSeen < DEDUP_WINDOW_MS) {
      existing.count += 1;
      return false;
    }
    existing.count += 1;
    existing.lastSeen = now;
  } else {
    _dedupMap.set(key, { count: 1, lastSeen: now });
  }

  _totalEmittedCount += 1;
  return true;
}

function handleUncaughtError(event: ErrorEvent): void {
  if (!_captureActive) return;

  const rawMessage = event.message || (event.error instanceof Error ? event.error.message : String(event.error ?? 'Uncaught error'));
  const message = String(rawMessage);
  const filename = sanitizeUrl(event.filename ?? '');
  const lineno = typeof event.lineno === 'number' ? event.lineno : 0;
  const colno = typeof event.colno === 'number' ? event.colno : 0;

  const dedupKey = buildErrorDedupKey('uncaught_exception', message, filename, lineno);
  if (!shouldEmitError(dedupKey)) {
    return;
  }

  window.postMessage(
    createRuntimeErrorObservationMessage({
      observationId: crypto.randomUUID(),
      kind: 'uncaught_exception',
      message,
      filename,
      lineno,
      colno,
      timestamp: Date.now(),
      runId: null,
    }),
    '*'
  );
}

function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  if (!_captureActive) return;

  let reasonMessage: string;
  try {
    reasonMessage =
      event.reason instanceof Error
        ? event.reason.message
        : String(event.reason);
  } catch {
    reasonMessage = '[unstringifiable rejection reason]';
  }

  const filename = '';
  const lineno = 0;
  const colno = 0;

  const dedupKey = buildErrorDedupKey('unhandled_rejection', reasonMessage, filename, lineno);
  if (!shouldEmitError(dedupKey)) {
    return;
  }

  window.postMessage(
    createRuntimeErrorObservationMessage({
      observationId: crypto.randomUUID(),
      kind: 'unhandled_rejection',
      message: reasonMessage,
      filename,
      lineno,
      colno,
      timestamp: Date.now(),
      runId: null,
    }),
    '*'
  );
}

export function activateRuntimeErrorCapture(): void {
  if (_captureActive) return;
  _captureActive = true;
  _totalEmittedCount = 0;
  _dedupMap.clear();

  if (typeof window !== 'undefined') {
    window.addEventListener('error', handleUncaughtError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
  }
  console.log('[HAVOC][page] runtime error capture activated');
}

export function deactivateRuntimeErrorCapture(): void {
  if (!_captureActive) return;
  _captureActive = false;
  _totalEmittedCount = 0;
  _dedupMap.clear();

  if (typeof window !== 'undefined') {
    window.removeEventListener('error', handleUncaughtError);
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  }
  console.log('[HAVOC][page] runtime error capture deactivated');
}
