/**
 * chaos-injector.ts — sends chaos commands to the target tab and tracks them
 * as reversible resources in the Resource Registry.
 *
 * Responsibilities:
 *  1. Send INJECT_CHAOS to the target tab's content script via
 *     chrome.tabs.sendMessage (content script relays it to the page world).
 *  2. Emit a CHAOS_INJECTED HavocEvent so downstream phases can trace
 *     causality: CHAOS_INJECTED.injectionId === REQUEST_*.injectionId.
 *  3. Register a 'experiment-lifetime' resource in the provided registry
 *     whose cleanup sends REMOVE_CHAOS and calls restoreChaos in the page.
 *
 * The CHAOS_INJECTED HavocEvent is constructed here in the SW (not in the page
 * world) because the SW is the authoritative sequence-number owner. The page
 * world emits a sentinel REQUEST_OBSERVATION with url='__chaos_injected__' that
 * the SW recognises and maps to CHAOS_INJECTED type — this allows the event to
 * carry the correct sequence number from the SW's monotonic counter.
 */

import type { Target } from '../../domain/target';
import type { ExperimentDefinition } from '../../domain/experiment';
import type { HavocEvent } from '../../domain/event';
import { createInjectChaosMessage, createRemoveChaosMessage, type ChaosParams } from '../../messaging/messages';
import type { ResourceRegistry } from './resource-registry';

/**
 * Thrown when the target tab doesn't have HAVOC's content script running.
 * The coordinator catches this and transitions to TARGET_LOST instead of FAILED,
 * because the tab is unreachable for chaos — not because the experiment itself
 * is broken.
 */
export class ContentScriptUnavailableError extends Error {
  constructor(tabId: number, detail: string) {
    super(`Content script not reachable in tab ${tabId}: ${detail}`);
    this.name = 'ContentScriptUnavailableError';
  }
}

const CONTENT_SCRIPT_ABSENT_PATTERN = /receiving end does not exist/i;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InjectionHandle {
  injectionId: string;
  chaosEvent: HavocEvent;
}

/**
 * Build ChaosParams from the ExperimentDefinition's params field.
 * Returns null if the definition doesn't map to a supported chaos kind.
 */
export function buildChaosParams(
  definition: ExperimentDefinition,
  runId: string
): ChaosParams | null {
  const injectionId = crypto.randomUUID();

  if (definition.kind === 'fetch_latency') {
    const delayMs = typeof definition.params.delayMs === 'number'
      ? definition.params.delayMs
      : 500; // sensible default
    return { kind: 'fetch_latency', delayMs, injectionId, runId };
  }

  if (definition.kind === 'fetch_failure') {
    const mode = (definition.params.mode as string | undefined) ?? 'transport_error';
    const syntheticStatus = typeof definition.params.syntheticStatus === 'number'
      ? definition.params.syntheticStatus
      : undefined;
    const timeoutMs = typeof definition.params.timeoutMs === 'number'
      ? definition.params.timeoutMs
      : undefined;
    return {
      kind: 'fetch_failure',
      mode: mode as ChaosParams['kind'] extends 'fetch_failure'
        ? import('../../messaging/messages').FetchFailureMode
        : never,
      ...(syntheticStatus !== undefined && { syntheticStatus }),
      ...(timeoutMs !== undefined && { timeoutMs }),
      injectionId,
      runId,
    } as ChaosParams;
  }

  if (definition.kind === 'input_stress') {
    const mode = (definition.params.mode as import('../../messaging/messages').InputStressMode | undefined) ?? 'all';
    return {
      kind: 'input_stress',
      mode,
      injectionId,
      runId,
    };
  }

  if (definition.kind === 'viewport_stress') {
    const mode = (definition.params.mode as import('../../messaging/messages').ViewportStressMode | undefined) ?? 'mobile_narrow';
    return {
      kind: 'viewport_stress',
      mode,
      injectionId,
      runId,
    };
  }

  return null;
}

/**
 * Send the chaos command to the target tab, emit a CHAOS_INJECTED HavocEvent,
 * and register a cleanup resource that will remove the chaos when the run ends.
 *
 * @param target       The tab to inject into.
 * @param params       The chaos configuration (built by buildChaosParams).
 * @param registry     The run's ResourceRegistry — cleanup is registered here.
 * @param nextSequence A function that returns the next monotonic sequence number.
 * @returns            A handle with the injectionId and the CHAOS_INJECTED event.
 */
export async function injectChaos(
  target: Target,
  params: ChaosParams,
  registry: ResourceRegistry,
  nextSequence: (runId: string) => number
): Promise<InjectionHandle> {
  // Send the injection command to the content script in the target tab.
  // The content script will forward it to the page world via window.postMessage.
  try {
    await chrome.tabs.sendMessage(target.tabId, createInjectChaosMessage(params));
    console.log(`[HAVOC][chaos] injected ${params.kind} into tab ${target.tabId} (injection: ${params.injectionId})`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // "Receiving end does not exist" means the content script is not loaded
    // in this tab (chrome:// page, extension page, or tab navigated away).
    // Surface as ContentScriptUnavailableError so the coordinator can
    // transition to TARGET_LOST rather than FAILED.
    if (CONTENT_SCRIPT_ABSENT_PATTERN.test(detail)) {
      throw new ContentScriptUnavailableError(target.tabId, detail);
    }
    throw new Error(`Failed to send INJECT_CHAOS to tab ${target.tabId}: ${detail}`);
  }

  // Build the CHAOS_INJECTED HavocEvent in the SW so it gets a correct
  // sequence number from the authoritative per-run counter.
  const chaosEvent: HavocEvent = {
    id: crypto.randomUUID(),
    runId: params.runId,
    timestamp: Date.now(),
    sequence: nextSequence(params.runId),
    type: 'CHAOS_INJECTED',
    source: 'service_worker',
    correlationId: params.injectionId,
    metadata: {
      kind: params.kind,
      tabId: target.tabId,
      origin: target.origin,
      ...(params.kind === 'fetch_latency' && { delayMs: params.delayMs }),
      ...(params.kind === 'fetch_failure' && {
        mode: params.mode,
        ...(params.syntheticStatus !== undefined && { syntheticStatus: params.syntheticStatus }),
        ...(params.timeoutMs !== undefined && { timeoutMs: params.timeoutMs }),
      }),
    },
  };

  console.log(
    `[HAVOC][SW] event #${chaosEvent.sequence} CHAOS_INJECTED`,
    params.kind,
    `(injection: ${params.injectionId})`
  );

  // Register the cleanup resource — scope is 'experiment-lifetime' so it
  // survives across multiple runs of the same experiment definition if needed,
  // but in practice the registry is fresh per run so it's cleaned up at run end.
  registry.register({
    id: `chaos:${params.injectionId}`,
    scope: 'experiment-lifetime',
    cleanup: async () => {
      try {
        await chrome.tabs.sendMessage(target.tabId, createRemoveChaosMessage(params.injectionId));
        console.log(`[HAVOC][chaos] removed ${params.kind} from tab ${target.tabId}`);
      } catch {
        // Tab may have closed — that's acceptable; the page world is gone.
        console.warn(`[HAVOC][chaos] could not send REMOVE_CHAOS to tab ${target.tabId} (tab may be closed)`);
      }
    },
  });

  return { injectionId: params.injectionId, chaosEvent };
}
