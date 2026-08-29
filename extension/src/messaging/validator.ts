import {
  HAVOC_NAMESPACE,
  BRIDGE_PROTOCOL_VERSION,
  type BridgeMessage,
  type BridgeMessageType,
  type ObservationPayload,
  type ObservationOutcome,
  type ObservationTransport,
  type GetCurrentRunMessage,
  type CurrentRunResponseMessage,
  type CreateRunMessage,
  type CreateRunResponseMessage,
  type RunStateUpdateMessage,
  type RuntimeMessageType,
  type ChaosParams,
  type FetchFailureMode,
} from './messages';

// ---------------------------------------------------------------------------
// Bridge message validator
// ---------------------------------------------------------------------------

const VALID_BRIDGE_TYPES: ReadonlySet<BridgeMessageType> = new Set([
  'BRIDGE_HELLO',
  'BRIDGE_READY',
  'BRIDGE_ERROR',
  'REQUEST_OBSERVATION',
  'INJECT_CHAOS',
  'REMOVE_CHAOS',
]);

export function isBridgeMessage(data: unknown): data is BridgeMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Record<string, unknown>;
  if (msg.namespace !== HAVOC_NAMESPACE) return false;
  if (msg.version !== BRIDGE_PROTOCOL_VERSION) return false;
  if (typeof msg.type !== 'string' || !VALID_BRIDGE_TYPES.has(msg.type as BridgeMessageType)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// ObservationPayload validator
// ---------------------------------------------------------------------------

const VALID_OUTCOMES: ReadonlySet<ObservationOutcome> = new Set([
  'success', 'transport_failure', 'http_failure', 'timeout',
]);

const VALID_TRANSPORTS: ReadonlySet<ObservationTransport> = new Set(['fetch', 'xhr']);

export function isObservationPayload(data: unknown): data is ObservationPayload {
  if (typeof data !== 'object' || data === null) return false;
  const p = data as Record<string, unknown>;
  if (typeof p.observationId !== 'string' || p.observationId.length === 0) return false;
  if (!VALID_TRANSPORTS.has(p.transport as ObservationTransport)) return false;
  if (!VALID_OUTCOMES.has(p.outcome as ObservationOutcome)) return false;
  if (typeof p.url !== 'string' || p.url.length === 0) return false;
  if (typeof p.method !== 'string' || p.method.length === 0) return false;
  if (typeof p.status !== 'number' || !Number.isInteger(p.status) || p.status < 0) return false;
  if (typeof p.startTime !== 'number' || !isFinite(p.startTime)) return false;
  if (typeof p.duration !== 'number' || !isFinite(p.duration) || p.duration < 0) return false;
  if ('errorMessage' in p && typeof p.errorMessage !== 'string') return false;
  if ('injectionId' in p && typeof p.injectionId !== 'string') return false;
  return true;
}

export function isObservationMessage(
  data: unknown
): data is BridgeMessage & { type: 'REQUEST_OBSERVATION'; payload: ObservationPayload } {
  if (!isBridgeMessage(data)) return false;
  if (data.type !== 'REQUEST_OBSERVATION') return false;
  return isObservationPayload(data.payload);
}

// ---------------------------------------------------------------------------
// ChaosParams validator
// ---------------------------------------------------------------------------

const VALID_FAILURE_MODES: ReadonlySet<FetchFailureMode> = new Set([
  'transport_error', 'synthetic_http_error', 'synthetic_timeout',
]);

export function isChaosParams(data: unknown): data is ChaosParams {
  if (typeof data !== 'object' || data === null) return false;
  const p = data as Record<string, unknown>;
  if (typeof p.injectionId !== 'string' || p.injectionId.length === 0) return false;
  if (typeof p.runId !== 'string' || p.runId.length === 0) return false;

  if (p.kind === 'fetch_latency') {
    return typeof p.delayMs === 'number' && p.delayMs >= 0 && isFinite(p.delayMs);
  }
  if (p.kind === 'fetch_failure') {
    if (!VALID_FAILURE_MODES.has(p.mode as FetchFailureMode)) return false;
    if ('syntheticStatus' in p && typeof p.syntheticStatus !== 'number') return false;
    if ('timeoutMs' in p && typeof p.timeoutMs !== 'number') return false;
    return true;
  }
  return false;
}

/**
 * Guard for INJECT_CHAOS messages arriving at the page via window.postMessage.
 * The page world is untrusted input so we validate the full ChaosParams payload.
 */
export function isChaosMessage(
  data: unknown
): data is BridgeMessage & { type: 'INJECT_CHAOS'; payload: ChaosParams } {
  if (!isBridgeMessage(data)) return false;
  if (data.type !== 'INJECT_CHAOS') return false;
  return isChaosParams(data.payload);
}

/**
 * Guard for REMOVE_CHAOS messages arriving at the page via window.postMessage.
 */
export function isRemoveChaosMessage(
  data: unknown
): data is BridgeMessage & { type: 'REMOVE_CHAOS'; payload: { injectionId: string } } {
  if (!isBridgeMessage(data)) return false;
  if (data.type !== 'REMOVE_CHAOS') return false;
  const p = data.payload as Record<string, unknown> | undefined;
  return typeof p?.injectionId === 'string' && p.injectionId.length > 0;
}

// ---------------------------------------------------------------------------
// Runtime message validators
// ---------------------------------------------------------------------------

const VALID_RUNTIME_TYPES: ReadonlySet<RuntimeMessageType> = new Set([
  'GET_CURRENT_RUN',
  'CURRENT_RUN_RESPONSE',
  'CREATE_RUN',
  'CREATE_RUN_RESPONSE',
  'RUN_STATE_UPDATE',
]);

function isRuntimeMessageBase(data: unknown): data is { type: RuntimeMessageType } {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Record<string, unknown>;
  if (msg.namespace !== HAVOC_NAMESPACE) return false;
  if (msg.version !== BRIDGE_PROTOCOL_VERSION) return false;
  if (typeof msg.type !== 'string' || !VALID_RUNTIME_TYPES.has(msg.type as RuntimeMessageType)) return false;
  return true;
}

export function isGetCurrentRunMessage(data: unknown): data is GetCurrentRunMessage {
  return isRuntimeMessageBase(data) && (data as GetCurrentRunMessage).type === 'GET_CURRENT_RUN';
}

export function isCurrentRunResponseMessage(data: unknown): data is CurrentRunResponseMessage {
  return isRuntimeMessageBase(data) && (data as CurrentRunResponseMessage).type === 'CURRENT_RUN_RESPONSE';
}

export function isCreateRunMessage(data: unknown): data is CreateRunMessage {
  if (!isRuntimeMessageBase(data)) return false;
  if ((data as CreateRunMessage).type !== 'CREATE_RUN') return false;
  const msg = data as Record<string, unknown>;
  const def = msg.definition as Record<string, unknown> | undefined;
  if (typeof def !== 'object' || def === null) return false;
  if (typeof def.id !== 'string' || def.id.length === 0) return false;
  if (typeof def.kind !== 'string' || def.kind.length === 0) return false;
  if (typeof def.name !== 'string' || def.name.length === 0) return false;
  return true;
}

export function isCreateRunResponseMessage(data: unknown): data is CreateRunResponseMessage {
  return isRuntimeMessageBase(data) && (data as CreateRunResponseMessage).type === 'CREATE_RUN_RESPONSE';
}

export function isRunStateUpdateMessage(data: unknown): data is RunStateUpdateMessage {
  return isRuntimeMessageBase(data) && (data as RunStateUpdateMessage).type === 'RUN_STATE_UPDATE';
}
