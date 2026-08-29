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
  type RuntimeMessageType,
} from './messages';

// ---------------------------------------------------------------------------
// Bridge message validator (postMessage / content-script channel)
// ---------------------------------------------------------------------------

const VALID_BRIDGE_TYPES: ReadonlySet<BridgeMessageType> = new Set([
  'BRIDGE_HELLO',
  'BRIDGE_READY',
  'BRIDGE_ERROR',
  'REQUEST_OBSERVATION',
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
// Re-validates the payload in the content script after crossing the untrusted
// postMessage boundary — the page world is untrusted input.
// ---------------------------------------------------------------------------

const VALID_OUTCOMES: ReadonlySet<ObservationOutcome> = new Set([
  'success',
  'transport_failure',
  'http_failure',
  'timeout',
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

  return true;
}

/**
 * Type guard for an inbound BridgeMessage that is specifically a
 * REQUEST_OBSERVATION with a validated ObservationPayload.
 * Used in the content script to safely destructure the payload.
 */
export function isObservationMessage(
  data: unknown
): data is BridgeMessage & { type: 'REQUEST_OBSERVATION'; payload: ObservationPayload } {
  if (!isBridgeMessage(data)) return false;
  if (data.type !== 'REQUEST_OBSERVATION') return false;
  return isObservationPayload(data.payload);
}

// ---------------------------------------------------------------------------
// Runtime message validators (chrome.runtime.sendMessage channel)
// ---------------------------------------------------------------------------

const VALID_RUNTIME_TYPES: ReadonlySet<RuntimeMessageType> = new Set([
  'GET_CURRENT_RUN',
  'CURRENT_RUN_RESPONSE',
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
