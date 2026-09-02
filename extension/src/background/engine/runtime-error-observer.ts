/**
 * runtime-error-observer.ts — PassiveCheckExecutor implementation for runtime error capture.
 *
 * Coordinates enabling/disabling runtime error capture on the target page and
 * collecting emitted error observations during the observation window.
 */

import type { PassiveCheckExecutor } from './passive-check-runner';
import type { RuntimeErrorPayload } from '../../messaging/messages';
import type { HavocEvent } from '../../domain/event';
import {
  createEnableRuntimeErrorCaptureMessage,
  createDisableRuntimeErrorCaptureMessage,
} from '../../messaging/messages';
import { isRuntimeErrorObservationMessage } from '../../messaging/validator';

/**
 * Convert a validated RuntimeErrorPayload into a HavocEvent.
 */
export function runtimeErrorToEvent(
  payload: RuntimeErrorPayload,
  runId: string,
  seq: number
): HavocEvent {
  const type =
    payload.kind === 'uncaught_exception'
      ? 'UNCAUGHT_EXCEPTION'
      : 'UNHANDLED_REJECTION';

  return {
    id: crypto.randomUUID(),
    runId,
    timestamp: payload.timestamp || Date.now(),
    sequence: seq,
    type,
    source: 'page',
    correlationId: payload.observationId,
    metadata: {
      message: payload.message,
      filename: payload.filename,
      lineno: payload.lineno,
      colno: payload.colno,
      observationId: payload.observationId,
      kind: payload.kind,
    },
  };
}

export const runtimeErrorObserverExecutor: PassiveCheckExecutor = async (
  target,
  definition,
  runId,
  nextSequence
) => {
  const observeMs =
    typeof definition.params.observeMs === 'number'
      ? definition.params.observeMs
      : 5000;
  const events: HavocEvent[] = [];

  // 1. Enable runtime error capture on the target page
  if (typeof chrome !== 'undefined' && chrome.tabs?.sendMessage) {
    await chrome.tabs
      .sendMessage(target.tabId, createEnableRuntimeErrorCaptureMessage())
      .catch((err: unknown) => {
        console.warn(
          `[HAVOC][runtime-errors] failed to send ENABLE to tab ${target.tabId}:`,
          err
        );
      });
  }

  // 2. Attach scoped message listener to collect runtime errors
  const messageListener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): boolean | undefined => {
    if (!isRuntimeErrorObservationMessage(message)) return undefined;
    if (sender.tab?.id !== target.tabId) return undefined;

    const event = runtimeErrorToEvent(
      message.payload,
      runId,
      nextSequence(runId)
    );
    events.push(event);
    sendResponse(null);
    return true;
  };

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(messageListener);
    }
    // Collect observations for observeMs duration
    await new Promise<void>((resolve) => setTimeout(resolve, observeMs));
  } finally {
    // 3. Remove scoped listener and disable capture on target page
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.removeListener(messageListener);
    }
    if (typeof chrome !== 'undefined' && chrome.tabs?.sendMessage) {
      await chrome.tabs
        .sendMessage(target.tabId, createDisableRuntimeErrorCaptureMessage())
        .catch((err: unknown) => {
          console.warn(
            `[HAVOC][runtime-errors] failed to send DISABLE to tab ${target.tabId}:`,
            err
          );
        });
    }
  }

  return { events };
};
