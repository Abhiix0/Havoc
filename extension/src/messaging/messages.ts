import type { ExperimentRun, ExperimentState } from '../domain/run';
import type { ExperimentDefinition } from '../domain/experiment';
import type { Target } from '../domain/target';

export const HAVOC_NAMESPACE = 'havoc' as const;
export const BRIDGE_PROTOCOL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

/**
 * Messages that travel over the page ↔ content-script bridge (postMessage).
 */
export type BridgeMessageType =
  | 'BRIDGE_HELLO'
  | 'BRIDGE_READY'
  | 'BRIDGE_ERROR'
  | 'REQUEST_OBSERVATION';

/** Messages that travel over the popup ↔ service-worker channel (chrome.runtime). */
export type RuntimeMessageType =
  | 'GET_CURRENT_RUN'
  | 'CURRENT_RUN_RESPONSE'
  | 'CREATE_RUN'
  | 'CREATE_RUN_RESPONSE'
  | 'RUN_STATE_UPDATE';

export type AnyMessageType = BridgeMessageType | RuntimeMessageType;

// ---------------------------------------------------------------------------
// Observation payload
// ---------------------------------------------------------------------------

export type ObservationOutcome = 'success' | 'transport_failure' | 'http_failure' | 'timeout';
export type ObservationTransport = 'fetch' | 'xhr';

export interface ObservationPayload {
  observationId: string;
  transport: ObservationTransport;
  outcome: ObservationOutcome;
  url: string;
  method: string;
  status: number;
  startTime: number;
  duration: number;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Bridge message (postMessage-based, page ↔ content-script)
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

export function createObservationMessage(obs: ObservationPayload): BridgeMessage {
  return createBridgeMessage('REQUEST_OBSERVATION', obs as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Runtime messages (chrome.runtime.sendMessage-based, popup ↔ SW)
// ---------------------------------------------------------------------------

export interface RuntimeMessage {
  namespace: typeof HAVOC_NAMESPACE;
  version: typeof BRIDGE_PROTOCOL_VERSION;
  type: RuntimeMessageType;
}

// --- GET_CURRENT_RUN ---

export interface GetCurrentRunMessage extends RuntimeMessage {
  type: 'GET_CURRENT_RUN';
}

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

// --- CREATE_RUN ---

/**
 * Popup → SW: request to start a new experiment run.
 * The SW resolves the active tab automatically; the popup only needs to supply
 * the ExperimentDefinition. The Target is filled in by the SW from the sender's
 * tab context or the currently active tab.
 */
export interface CreateRunMessage extends RuntimeMessage {
  type: 'CREATE_RUN';
  definition: ExperimentDefinition;
  /** Optional: explicit target. If omitted the SW uses the currently active tab. */
  target?: Target;
}

export interface CreateRunResponseMessage extends RuntimeMessage {
  type: 'CREATE_RUN_RESPONSE';
  /** The newly created run on success. */
  run?: ExperimentRun;
  /** Human-readable error if the run could not be created. */
  error?: string;
}

export function createCreateRunMessage(
  definition: ExperimentDefinition,
  target?: Target
): CreateRunMessage {
  return {
    namespace: HAVOC_NAMESPACE,
    version: BRIDGE_PROTOCOL_VERSION,
    type: 'CREATE_RUN',
    definition,
    ...(target !== undefined && { target }),
  };
}

export function createCreateRunResponseMessage(
  run: ExperimentRun | undefined,
  error?: string
): CreateRunResponseMessage {
  return {
    namespace: HAVOC_NAMESPACE,
    version: BRIDGE_PROTOCOL_VERSION,
    type: 'CREATE_RUN_RESPONSE',
    ...(run !== undefined && { run }),
    ...(error !== undefined && { error }),
  };
}

// --- RUN_STATE_UPDATE (SW → popup push notification) ---

/**
 * SW → popup: notifies the popup that the current run changed state.
 * Sent as a broadcast via chrome.runtime.sendMessage so the popup can
 * update its display without polling.
 */
export interface RunStateUpdateMessage extends RuntimeMessage {
  type: 'RUN_STATE_UPDATE';
  run: ExperimentRun | null;
  /** The previous state, for UI transition animations. */
  previousState: ExperimentState | null;
}

export function createRunStateUpdateMessage(
  run: ExperimentRun | null,
  previousState: ExperimentState | null
): RunStateUpdateMessage {
  return {
    namespace: HAVOC_NAMESPACE,
    version: BRIDGE_PROTOCOL_VERSION,
    type: 'RUN_STATE_UPDATE',
    run,
    previousState,
  };
}
