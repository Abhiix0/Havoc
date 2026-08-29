export const HAVOC_NAMESPACE = 'havoc' as const;
export const BRIDGE_PROTOCOL_VERSION = 1 as const;

export type BridgeMessageType = 'BRIDGE_HELLO' | 'BRIDGE_READY' | 'BRIDGE_ERROR';

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