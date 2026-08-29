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
 *
 * INJECT_CHAOS / REMOVE_CHAOS travel SW → content → page (reverse direction
 * from observations). The content script relays them via window.postMessage;
 * bridge.ts receives and applies them to the instrumentation layer.
 */
export type BridgeMessageType =
  | 'BRIDGE_HELLO'
  | 'BRIDGE_READY'
  | 'BRIDGE_ERROR'
  | 'REQUEST_OBSERVATION'
  | 'INJECT_CHAOS'
  | 'REMOVE_CHAOS';

/** Messages that travel over the popup ↔ service-worker channel (chrome.runtime). */
export type RuntimeMessageType =
  | 'GET_CURRENT_RUN'
  | 'CURRENT_RUN_RESPONSE'
  | 'CREATE_RUN'
  | 'CREATE_RUN_RESPONSE'
  | 'RUN_STATE_UPDATE';

export type AnyMessageType = BridgeMessageType | RuntimeMessageType;

// ---------------------------------------------------------------------------
// Chaos command payload
// ---------------------------------------------------------------------------

/**
 * Failure modes for fetch_failure experiments:
 *   transport_error      — fetch() promise rejects (simulates DNS/network failure)
 *   synthetic_http_error — fetch() resolves with a synthetic non-ok Response (e.g. 503)
 *   synthetic_timeout    — fetch() hangs until an AbortSignal fires (simulates timeout)
 *
 * V1 scope note: chaos applies to ALL fetches on the instrumented page.
 * Per-URL filtering is a future enhancement. This is intentional and explicit:
 * the experiment targets the entire fetch surface of the page, not individual
 * endpoints. A future 'urlPattern' field will narrow scope.
 */
export type FetchFailureMode =
  | 'transport_error'
  | 'synthetic_http_error'
  | 'synthetic_timeout';

export interface FetchLatencyChaosParams {
  kind: 'fetch_latency';
  /** Additional delay in milliseconds added to every fetch call. */
  delayMs: number;
  /** Stable ID for correlating CHAOS_INJECTED with downstream REQUEST_* events. */
  injectionId: string;
  /** The runId this injection belongs to. */
  runId: string;
}

export interface FetchFailureChaosParams {
  kind: 'fetch_failure';
  mode: FetchFailureMode;
  /**
   * HTTP status code used when mode === 'synthetic_http_error'.
   * Ignored for other modes. Defaults to 503 if omitted.
   */
  syntheticStatus?: number;
  /**
   * Timeout in ms for synthetic_timeout mode. After this delay the injected
   * fetch will reject with an AbortError.
   */
  timeoutMs?: number;
  /** Stable ID for correlating CHAOS_INJECTED with downstream REQUEST_* events. */
  injectionId: string;
  /** The runId this injection belongs to. */
  runId: string;
}

export type ChaosParams = FetchLatencyChaosParams | FetchFailureChaosParams;

// ---------------------------------------------------------------------------
// Bridge messages
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

/** SW → page (via content script relay): activate chaos. */
export function createInjectChaosMessage(params: ChaosParams): BridgeMessage {
  return createBridgeMessage('INJECT_CHAOS', params as unknown as Record<string, unknown>);
}

/** SW → page (via content script relay): deactivate chaos and restore fetch. */
export function createRemoveChaosMessage(injectionId: string): BridgeMessage {
  return createBridgeMessage('REMOVE_CHAOS', { injectionId });
}

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
  /**
   * Set when this observation was produced while chaos was active.
   * Links back to the CHAOS_INJECTED event with this id.
   */
  injectionId?: string;
}

// ---------------------------------------------------------------------------
// Runtime messages (chrome.runtime — popup ↔ SW)
// ---------------------------------------------------------------------------

export interface RuntimeMessage {
  namespace: typeof HAVOC_NAMESPACE;
  version: typeof BRIDGE_PROTOCOL_VERSION;
  type: RuntimeMessageType;
}

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

export interface CreateRunMessage extends RuntimeMessage {
  type: 'CREATE_RUN';
  definition: ExperimentDefinition;
  target?: Target;
}

export interface CreateRunResponseMessage extends RuntimeMessage {
  type: 'CREATE_RUN_RESPONSE';
  run?: ExperimentRun;
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

export interface RunStateUpdateMessage extends RuntimeMessage {
  type: 'RUN_STATE_UPDATE';
  run: ExperimentRun | null;
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
