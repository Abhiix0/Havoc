import {
  HAVOC_NAMESPACE,
  BRIDGE_PROTOCOL_VERSION,
  type BridgeMessage,
  type BridgeMessageType,
} from './messages';

const VALID_TYPES: ReadonlySet<BridgeMessageType> = new Set([
  'BRIDGE_HELLO',
  'BRIDGE_READY',
  'BRIDGE_ERROR',
]);

export function isBridgeMessage(data: unknown): data is BridgeMessage {
  if (typeof data !== 'object' || data === null) return false;
  const msg = data as Record<string, unknown>;
  if (msg.namespace !== HAVOC_NAMESPACE) return false;
  if (msg.version !== BRIDGE_PROTOCOL_VERSION) return false;
  if (typeof msg.type !== 'string' || !VALID_TYPES.has(msg.type as BridgeMessageType)) return false;
  return true;
}