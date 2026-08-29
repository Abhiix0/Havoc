import type { ExperimentRun } from '../domain/run';

export const HAVOC_NAMESPACE = 'havoc' as const;
export const BRIDGE_PROTOCOL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

/**
 * Messages that travel over the page ↔ content-script bridge (postMessage).
 * REQUEST_OBSERVATION carries a network observation from the instrumented page
 * world up to the content script, which re-validates and forwards it to the SW.
 */
export type BridgeMessageType =
  | 'BRIDGE_HELLO'
  | 'BRIDGE_READY'
  | 'BRIDGE_ERROR'
  | 'REQUEST_OBSERVATION';

/** Messages that travel over the popup ↔ service-worker channel (chrome.runtime). */
export type RuntimeMessageType = 'GET_CURRENT_RUN' | 'CURRENT_RUN_RESPONSE';

export type AnyMessageType = BridgeMessageType | RuntimeMessageType;

// ---------------------------------------------------------------------------
// Observation payload — the structured data carried in REQUEST_OBSERVATION.
// ---------------------------------------------------------------------------

/**
 * Three distinct outcomes, never collapsed into each other:
 *
 *  - transport_failure  fetch() Promise rejected / XHR error event
 *                       (DNS failure, connection refused, CORS block, etc.)
 *  - http_failure       Promise resolved but response.ok === false (4xx / 5xx)
 *  - timeout            XHR ontimeout fired, or fetch AbortController timeout
 *                       (stubbed for fetch in Phase 2; real detection in Phase 4)
 *  - success            response.ok === true / XHR load with 2xx status
 */
export type ObservationOutcome = 'success' | 'transport_failure' | 'http_failure' | 'timeout';

/** The transport mechanism that produced this observation. */
export type ObservationTransport = 'fetch' | 'xhr';

export interface ObservationPayload {
  /** Stable UUID generated at instrumentation time, used as correlationId in HavocEvent. */
  observationId: string;
  transport: ObservationTransport;
  outcome: ObservationOutcome;
  /** The URL passed to fetch() or xhr.open(). */
  url: string;
  /** HTTP method in upper-case, e.g. "GET". */
  method: string;
  /**
   * HTTP status code. 0 for transport failures (no response received).
   * Carried as a number so the SW can inspect it without parsing strings.
   */
  status: number;
  /** High-resolution timestamp (ms since page load, via performance.now()). */
  startTime: number;
  /** Duration from request start to observation, in ms. */
  duration: number;
  /** Human-readable error message for transport_failure / timeout cases. */
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

/** Typed convenience constructor for REQUEST_OBSERVATION messages. */
export function createObservationMessage(obs: ObservationPayload): BridgeMessage {
  // ObservationPayload satisfies Record<string, unknown> after cast — we spread
  // it into payload so it travels over the existing BridgeMessage pipeline.
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
  return {
    namespace: HAVOC_NAMESPACE,
    version: BRIDGE_PROTOCOL_VERSION,
    type: 'CURRENT_RUN_RESPONSE',
    run,
  };
}
