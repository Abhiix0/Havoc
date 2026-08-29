import {
  HAVOC_NAMESPACE,
  BRIDGE_PROTOCOL_VERSION,
  type BridgeMessage,
  type BridgeMessageType,
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
