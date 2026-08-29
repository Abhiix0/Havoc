import type { ExperimentRun } from '../domain/run';

export const HAVOC_NAMESPACE = 'havoc' as const;
export const BRIDGE_PROTOCOL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

/** Messages that travel over the page ↔ content-script bridge (postMessage). */
export type BridgeMessageType = 'BRIDGE_HELLO' | 'BRIDGE_READY' | 'BRIDGE_ERROR';

/** Messages that travel over the popup ↔ service-worker channel (chrome.runtime). */
export type RuntimeMessageType = 'GET_CURRENT_RUN' | 'CURRENT_RUN_RESPONSE';

export type AnyMessageType = BridgeMessageType | RuntimeMessageType;

// ---------------------------------------------------------------------------
// Bridge message (postMessage-based, page ↔ SW relay)
// ---------------------------------------------------------------------------

export interface BridgeMessage {
  namespace: typeof HAVOC_NAMESPACE;
  version: typeof BRIDGE_PROTOCOL_VERSION;
  type: BridgeMessageType;
  payload?: Record<string, unknown>;
}

export function createBridgeMessage(
  type: BridgeMessageType,
  payload?: Record<string, unknown>
): BridgeMessage {
  return {
    namespace: HAVOC_NAMESPACE,
    version: BRIDGE_PROTOCOL_VERSION,
    type,
    ...(payload !== undefined && { payload }),
  };
}

// ---------------------------------------------------------------------------
// Runtime messages (chrome.runtime.sendMessage-based, popup ↔ SW)
// ---------------------------------------------------------------------------

export interface RuntimeMessage {
  namespace: typeof HAVOC_NAMESPACE;
  version: typeof BRIDGE_PROTOCOL_VERSION;
  type: RuntimeMessageType;
}

/** Popup → SW: ask for the current run snapshot. */
export interface GetCurrentRunMessage extends RuntimeMessage {
  type: 'GET_CURRENT_RUN';
}

/**
 * SW → Popup: answer to GET_CURRENT_RUN.
 * `run` is null when no experiment is active.
 */
export interface CurrentRunResponseMessage extends RuntimeMessage {
  type: 'CURRENT_RUN_RESPONSE';
  run: ExperimentRun | null;
}

export function createGetCurrentRunMessage(): GetCurrentRunMessage {
  return { namespace: HAVOC_NAMESPACE, version: BRIDGE_PROTOCOL_VERSION, type: 'GET_CURRENT_RUN' };
}

export function createCurrentRunResponseMessage(
  run: ExperimentRun | null
): CurrentRunResponseMessage {
  return { namespace: HAVOC_NAMESPACE, version: BRIDGE_PROTOCOL_VERSION, type: 'CURRENT_RUN_RESPONSE', run };
}
