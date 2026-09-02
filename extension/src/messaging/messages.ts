import type { ExperimentRun, ExperimentState } from '../domain/run';
import type { PassiveCheckRun, PassiveCheckState } from '../domain/passive-check';
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
 *
 * DOM_OBSERVATION carries lightweight DOM mutation signals from the content
 * script's MutationObserver up to the SW, where the Signal Engine uses them
 * to derive LoadingStateDetected and ErrorStateDetected signals.
 */
export type BridgeMessageType =
  | 'BRIDGE_HELLO'
  | 'BRIDGE_READY'
  | 'BRIDGE_ERROR'
  | 'REQUEST_OBSERVATION'
  | 'INJECT_CHAOS'
  | 'REMOVE_CHAOS'
  | 'DOM_OBSERVATION'
  | 'RUNTIME_ERROR_OBSERVATION'
  | 'ENABLE_RUNTIME_ERROR_CAPTURE'
  | 'DISABLE_RUNTIME_ERROR_CAPTURE';

/** Messages that travel over the popup ↔ service-worker channel (chrome.runtime). */
export type RuntimeMessageType =
  | 'GET_CURRENT_RUN'
  | 'CURRENT_RUN_RESPONSE'
  | 'CREATE_RUN'
  | 'CREATE_RUN_RESPONSE'
  | 'RUN_STATE_UPDATE'
  | 'ABORT_RUN'
  | 'PASSIVE_RUN_STATE_UPDATE';

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

export type InputStressMode =
  | 'all'
  | 'empty'
  | 'whitespace'
  | 'unicode'
  | 'emoji'
  | 'long_text'
  | 'numeric_extreme';

export interface InputStressChaosParams {
  kind: 'input_stress';
  mode?: InputStressMode;
  injectionId: string;
  runId: string;
}

export type ViewportStressMode = 'mobile_narrow' | 'overflow_squeeze' | 'extreme_zoom';

export interface ViewportStressChaosParams {
  kind: 'viewport_stress';
  mode?: ViewportStressMode;
  injectionId: string;
  runId: string;
}

export type ChaosParams =
  | FetchLatencyChaosParams
  | FetchFailureChaosParams
  | InputStressChaosParams
  | ViewportStressChaosParams;

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
// DOM observation payload — emitted by the content script's MutationObserver.
// Travels content → SW (via chrome.runtime.sendMessage, not postMessage,
// because the content script already has chrome.runtime access and we want
// to keep this out of the untrusted page world).
// ---------------------------------------------------------------------------

/**
 * Coarse classification of what the MutationObserver detected.
 * Deliberately kept narrow — we only emit what we can classify with
 * reasonable precision. Unclassified mutations are not emitted.
 *
 *   loading_indicator_appeared  — an element matching loading/spinner
 *                                 heuristics became visible
 *   loading_indicator_removed   — such an element was removed
 *   error_text_appeared         — visible text matching error/failure
 *                                 patterns was added to the DOM
 *   aria_live_changed           — an aria-live region changed (often
 *                                 used for status/error announcements)
 */
export type DomMutationKind =
  | 'loading_indicator_appeared'
  | 'loading_indicator_removed'
  | 'error_text_appeared'
  | 'aria_live_changed'
  | 'layout_overflow_detected';

export interface DomObservationPayload {
  /** Monotonic timestamp from the MutationObserver record (performance.now() basis). */
  observedAt: number;
  /** Wall-clock timestamp when the content script emitted this observation. */
  timestamp: number;
  kind: DomMutationKind;
  /**
   * CSS selector of the mutated element, truncated to 120 chars.
   * Best-effort — may be empty if the element has no stable selector.
   */
  selector: string;
  /**
   * Up to 80 chars of the element's trimmed textContent at observation time.
   * Used for error_text_appeared pattern matching in the Signal Engine.
   */
  textSnippet: string;
  /** The runId active at observation time, or null if no run is active. */
  runId: string | null;
}

export interface DomObservationMessage {
  namespace: typeof HAVOC_NAMESPACE;
  version: typeof BRIDGE_PROTOCOL_VERSION;
  type: 'DOM_OBSERVATION';
  payload: DomObservationPayload;
}

export function createDomObservationMessage(
  payload: DomObservationPayload
): DomObservationMessage {
  return { namespace: HAVOC_NAMESPACE, version: BRIDGE_PROTOCOL_VERSION, type: 'DOM_OBSERVATION', payload };
}

// ---------------------------------------------------------------------------
// Runtime Error observation payload
// ---------------------------------------------------------------------------

export type RuntimeErrorKind = 'uncaught_exception' | 'unhandled_rejection';

export interface RuntimeErrorPayload {
  observationId: string;
  kind: RuntimeErrorKind;
  message: string;
  filename: string;
  lineno: number;
  colno: number;
  timestamp: number;
  runId: string | null;
}

export interface RuntimeErrorObservationMessage {
  namespace: typeof HAVOC_NAMESPACE;
  version: typeof BRIDGE_PROTOCOL_VERSION;
  type: 'RUNTIME_ERROR_OBSERVATION';
  payload: RuntimeErrorPayload;
}

export function createRuntimeErrorObservationMessage(
  payload: RuntimeErrorPayload
): RuntimeErrorObservationMessage {
  return {
    namespace: HAVOC_NAMESPACE,
    version: BRIDGE_PROTOCOL_VERSION,
    type: 'RUNTIME_ERROR_OBSERVATION',
    payload,
  };
}

export function createEnableRuntimeErrorCaptureMessage(): BridgeMessage {
  return createBridgeMessage('ENABLE_RUNTIME_ERROR_CAPTURE');
}

export function createDisableRuntimeErrorCaptureMessage(): BridgeMessage {
  return createBridgeMessage('DISABLE_RUNTIME_ERROR_CAPTURE');
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

export interface PassiveRunStateUpdateMessage extends RuntimeMessage {
  type: 'PASSIVE_RUN_STATE_UPDATE';
  run: PassiveCheckRun | null;
  previousState: PassiveCheckState | null;
}

export function createPassiveRunStateUpdateMessage(
  run: PassiveCheckRun | null,
  previousState: PassiveCheckState | null
): PassiveRunStateUpdateMessage {
  return {
    namespace: HAVOC_NAMESPACE,
    version: BRIDGE_PROTOCOL_VERSION,
    type: 'PASSIVE_RUN_STATE_UPDATE',
    run,
    previousState,
  };
}

export interface AbortRunMessage extends RuntimeMessage {
  type: 'ABORT_RUN';
}

export function createAbortRunMessage(): AbortRunMessage {
  return {
    namespace: HAVOC_NAMESPACE,
    version: BRIDGE_PROTOCOL_VERSION,
    type: 'ABORT_RUN',
  };
}
