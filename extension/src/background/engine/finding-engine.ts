/**
 * finding-engine.ts — constructs Finding objects from a resolved Recovery
 * and its contributing evidence.
 *
 * Contract:
 *  - A Finding is only produced when the evidence justifies an actionable
 *    conclusion. RECOVERED and UNKNOWN do not produce Findings by default
 *    (RECOVERED is success, UNKNOWN lacks evidence for a conclusion).
 *  - Every evidenceId in a Finding points to a real Evidence object that
 *    wraps a real HavocEvent or Signal id (refId). No fabricated ids.
 *  - Severity and confidence are derived from the Recovery outcome and the
 *    confidence scores of the contributing signals — never hardcoded.
 *
 * Severity mapping:
 *   FAILED   + high-confidence failure signals → HIGH
 *   FAILED   + low-confidence signals          → MEDIUM
 *   DEGRADED                                   → MEDIUM
 *   RECOVERED / UNKNOWN                        → no Finding (return null)
 *
 * Finding confidence is the mean confidence of contributing RequestFailureObserved
 * signals, capped at 0.95. If no such signals are present but the outcome
 * is FAILED, we use the raw failure event count as a proxy (0.70 baseline).
 */

import type { HavocEvent } from '../../domain/event';
import type { Signal } from '../../domain/signal';
import type { Recovery } from '../../domain/recovery';
import type { Evidence } from '../../domain/evidence';
import type { Finding, FindingSeverity } from '../../domain/finding';
import type { RecoveryWindowResult } from './recovery-window';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FindingEngineInput {
  runId: string;
  recovery: Recovery;
  contributingEventIds: string[];
  contributingSignalIds: string[];
  /** Full event map so we can wrap them in Evidence. */
  eventIndex: Map<string, HavocEvent>;
  /** Full signal map so we can wrap them in Evidence. */
  signalIndex: Map<string, Signal>;
  checkKind?: import('../../domain/ship-check').ShipCheckStepKind | undefined;
}

export interface FindingEngineResult {
  /** null when outcome is RECOVERED or UNKNOWN (no actionable conclusion). */
  finding: Finding | null;
  /** All Evidence objects created — always populated even if finding is null,
   *  for audit / future use. */
  evidence: Evidence[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvidence(runId: string, kind: Evidence['kind'], refId: string): Evidence {
  return {
    id: crypto.randomUUID(),
    runId,
    kind,
    refId,
    capturedAt: Date.now(),
  };
}

function describeOutcome(
  outcome: Recovery['outcome'],
  eventCount: number,
  signalCount: number
): string {
  switch (outcome) {
    case 'FAILED':
      return (
        `Application did not recover after chaos injection. ` +
        `${eventCount} failure event(s) and ${signalCount} signal(s) observed ` +
        `with no successful retry or recovery indicators within the recovery window.`
      );
    case 'DEGRADED':
      return (
        `Application entered an error state after chaos injection and began ` +
        `a recovery attempt (loading indicators cleared), but did not complete ` +
        `a successful request within the recovery window. ` +
        `${eventCount} failure event(s) and ${signalCount} signal(s) observed.`
      );
    case 'RECOVERED':
      return `Application recovered successfully — successful retries observed within the recovery window.`;
    case 'UNKNOWN':
      return `Recovery outcome could not be determined — insufficient observable evidence within the recovery window.`;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build Evidence objects and, when justified, a Finding from the recovery result.
 *
 * @param input   All the inputs needed to build evidence and the finding.
 * @returns       A FindingEngineResult with the finding (or null) and all evidence.
 */
export function deriveFinding(input: FindingEngineInput): FindingEngineResult {
  const { runId, recovery, contributingEventIds, contributingSignalIds, eventIndex, signalIndex, checkKind } = input;

  // ── Build Evidence ────────────────────────────────────────────────────────
  // Wrap every contributing event and signal in an Evidence object.
  // evidenceId → Evidence.id (not the raw event/signal id).
  const evidence: Evidence[] = [];

  for (const eid of contributingEventIds) {
    if (eventIndex.has(eid)) {
      evidence.push(makeEvidence(runId, 'event', eid));
    }
    // If the event isn't in the index it was from a different activation —
    // skip rather than fabricate.
  }

  for (const sid of contributingSignalIds) {
    if (signalIndex.has(sid)) {
      evidence.push(makeEvidence(runId, 'signal', sid));
    }
  }

  // Always add the Recovery record itself as evidence (kind: 'metric').
  const recoveryEvidence = makeEvidence(runId, 'metric', recovery.id);
  evidence.push(recoveryEvidence);

  const evidenceIds = evidence.map((e) => e.id);

  // ── Decide whether to produce a Finding ───────────────────────────────────
  if (recovery.outcome === 'RECOVERED' || recovery.outcome === 'UNKNOWN') {
    // RECOVERED: success — no finding needed.
    // UNKNOWN: insufficient evidence — producing a finding would be unjustified.
    return { finding: null, evidence };
  }

  // ── Compute confidence ────────────────────────────────────────────────────
  // Use mean confidence of RequestFailureObserved signals as the base.
  const failureSignals = contributingSignalIds
    .map((id) => signalIndex.get(id))
    .filter((s): s is Signal => s !== undefined && s.type === 'RequestFailureObserved');

  let confidence: number;
  if (failureSignals.length > 0) {
    const mean = failureSignals.reduce((sum, s) => sum + s.confidence, 0) / failureSignals.length;
    confidence = Math.min(mean, 0.95);
  } else {
    // No failure signals — use event count as a proxy.
    // More failure events = more evidence, but cap at 0.80 without signal corroboration.
    const failureEventCount = contributingEventIds.filter((id) => {
      const e = eventIndex.get(id);
      return e !== undefined && ['REQUEST_TRANSPORT_FAILURE', 'REQUEST_HTTP_FAILURE', 'REQUEST_TIMEOUT'].includes(e.type);
    }).length;
    confidence = Math.min(0.70 + failureEventCount * 0.02, 0.80);
  }

  // ── Compute severity ──────────────────────────────────────────────────────
  let severity: FindingSeverity;
  if (recovery.outcome === 'FAILED') {
    severity = confidence >= 0.90 ? 'HIGH' : 'MEDIUM';
  } else {
    // DEGRADED
    severity = 'MEDIUM';
  }

  const finding: Finding = {
    id: crypto.randomUUID(),
    runId,
    severity,
    confidence,
    description: describeOutcome(
      recovery.outcome,
      contributingEventIds.length,
      contributingSignalIds.length
    ),
    evidenceIds,
    recoveryId: recovery.id,
    ...(checkKind !== undefined && { checkKind }),
  };

  console.log(
    `[HAVOC][finding] ${finding.severity} confidence=${finding.confidence.toFixed(2)}`,
    `outcome=${recovery.outcome}`,
    `evidence=${evidence.length}`
  );

  return { finding, evidence };
}

/**
 * Convenience wrapper that takes a RecoveryWindowResult and the live engine
 * indexes, and returns the full FindingEngineResult.
 */
export function deriveFromRecoveryResult(
  runId: string,
  result: RecoveryWindowResult,
  eventIndex: Map<string, HavocEvent>,
  signalIndex: Map<string, Signal>,
  checkKind?: import('../../domain/ship-check').ShipCheckStepKind
): FindingEngineResult {
  return deriveFinding({
    runId,
    recovery: result.recovery,
    contributingEventIds: result.contributingEventIds,
    contributingSignalIds: result.contributingSignalIds,
    eventIndex,
    signalIndex,
    checkKind,
  });
}

/**
 * Derive a Finding for passive runtime error checks.
 * Does not require a Recovery record. Zero observed errors is a clean negative (null finding).
 */
export function deriveFindingFromRuntimeErrors(
  runId: string,
  errorEvents: HavocEvent[],
  errorSignals: Signal[],
  eventIndex: Map<string, HavocEvent>,
  signalIndex: Map<string, Signal>,
  checkKind: import('../../domain/ship-check').ShipCheckStepKind = 'runtime_errors'
): FindingEngineResult {
  const evidence: Evidence[] = [];

  for (const event of errorEvents) {
    if (eventIndex.has(event.id)) {
      evidence.push(makeEvidence(runId, 'event', event.id));
    }
  }

  for (const signal of errorSignals) {
    if (signalIndex.has(signal.id)) {
      evidence.push(makeEvidence(runId, 'signal', signal.id));
    }
  }

  if (errorSignals.length === 0) {
    return { finding: null, evidence };
  }

  const messages = errorEvents
    .map((e) => (typeof e.metadata?.message === 'string' ? e.metadata.message : ''))
    .filter((m) => m.length > 0);

  const distinctMessages = Array.from(new Set(messages));
  const severity: FindingSeverity = distinctMessages.length >= 2 ? 'HIGH' : 'MEDIUM';

  const confidenceSum = errorSignals.reduce((sum, s) => sum + s.confidence, 0);
  const confidence = errorSignals.length > 0 ? confidenceSum / errorSignals.length : 0.98;

  const formattedMessages = distinctMessages
    .map((m) => `"${m.slice(0, 200)}"`)
    .join(', ');

  const description =
    `Observed ${errorEvents.length} runtime error(s) across ${distinctMessages.length} distinct message(s): ${formattedMessages}.`;

  const finding: Finding = {
    id: crypto.randomUUID(),
    runId,
    severity,
    confidence,
    description,
    evidenceIds: evidence.map((e) => e.id),
    checkKind,
  };

  console.log(
    `[HAVOC][finding] ${finding.severity} confidence=${finding.confidence.toFixed(2)}`,
    `runtime_errors=${errorEvents.length}`,
    `evidence=${evidence.length}`
  );

  return { finding, evidence };
}

/**
 * Derive a Finding for passive secret exposure checks.
 * Zero matches is a clean negative (null finding).
 */
export function deriveFindingFromSecretMatches(
  runId: string,
  matchEvents: HavocEvent[],
  matchSignals: Signal[],
  eventIndex: Map<string, HavocEvent>,
  signalIndex: Map<string, Signal>,
  checkKind: import('../../domain/ship-check').ShipCheckStepKind = 'secret_scan'
): FindingEngineResult {
  const evidence: Evidence[] = [];

  for (const event of matchEvents) {
    if (eventIndex.has(event.id)) {
      evidence.push(makeEvidence(runId, 'event', event.id));
    }
  }

  for (const signal of matchSignals) {
    if (signalIndex.has(signal.id)) {
      evidence.push(makeEvidence(runId, 'signal', signal.id));
    }
  }

  if (matchSignals.length === 0) {
    return { finding: null, evidence };
  }

  const hasHigh = matchEvents.some((e) => e.metadata?.severity === 'HIGH');
  const severity: FindingSeverity = hasHigh ? 'HIGH' : 'MEDIUM';
  const confidence = 0.60;

  const labels = Array.from(
    new Set(
      matchEvents
        .map((e) => (typeof e.metadata?.label === 'string' ? e.metadata.label : ''))
        .filter((l) => l.length > 0)
    )
  );

  const sources = Array.from(
    new Set(
      matchEvents
        .map((e) => (typeof e.metadata?.sourceDescription === 'string' ? e.metadata.sourceDescription : ''))
        .filter((s) => s.length > 0)
    )
  );

  const disclaimer =
    'This is a heuristic exposure check, not a guarantee of security. Absence of a finding does not mean your application has no exposed secrets.';

  const description =
    `${disclaimer} Observed ${matchEvents.length} potential secret match(es) across ${labels.length} pattern categories (${labels.join(', ')}) in ${sources.length} script source(s) (${sources.join(', ')}).`;

  const finding: Finding = {
    id: crypto.randomUUID(),
    runId,
    severity,
    confidence,
    description,
    evidenceIds: evidence.map((e) => e.id),
    checkKind,
  };

  console.log(
    `[HAVOC][finding] ${finding.severity} confidence=${finding.confidence.toFixed(2)}`,
    `secret_matches=${matchEvents.length}`,
    `evidence=${evidence.length}`
  );

  return { finding, evidence };
}

/**
 * Derive a Finding for viewport stress layout overflow detections.
 * Zero overflow signals is a clean negative (null finding).
 */
export function deriveFindingFromLayoutOverflow(
  runId: string,
  overflowSignals: Signal[],
  eventIndex: Map<string, HavocEvent>,
  signalIndex: Map<string, Signal>
): FindingEngineResult {
  const evidence: Evidence[] = [];

  for (const signal of overflowSignals) {
    if (signalIndex.has(signal.id)) {
      evidence.push(makeEvidence(runId, 'signal', signal.id));
    }
    for (const eventId of signal.derivedFrom) {
      if (eventIndex.has(eventId)) {
        evidence.push(makeEvidence(runId, 'event', eventId));
      }
    }
  }

  if (overflowSignals.length === 0) {
    return { finding: null, evidence: [] };
  }

  const confidenceSum = overflowSignals.reduce((sum, s) => sum + s.confidence, 0);
  const confidence = confidenceSum / overflowSignals.length;

  const snippets = overflowSignals.flatMap((s) =>
    s.derivedFrom
      .map((eid) => eventIndex.get(eid))
      .filter((e): e is HavocEvent => e !== undefined && e.type === 'DOM_OBSERVATION')
      .map((e) => (typeof e.metadata?.textSnippet === 'string' ? e.metadata.textSnippet : ''))
      .filter((t) => t.length > 0)
  );

  const distinctSnippets = Array.from(new Set(snippets));
  const snippetText = distinctSnippets.length > 0 ? `: ${distinctSnippets.join(', ')}` : '';

  const description =
    `Horizontal layout overflow detected during viewport stress testing${snippetText}. Content exceeds viewport width.`;

  const finding: Finding = {
    id: crypto.randomUUID(),
    runId,
    severity: 'MEDIUM',
    confidence,
    description,
    evidenceIds: evidence.map((e) => e.id),
    checkKind: 'viewport_stress',
  };

  console.log(
    `[HAVOC][finding] ${finding.severity} confidence=${finding.confidence.toFixed(2)}`,
    `layout_overflow_signals=${overflowSignals.length}`,
    `evidence=${evidence.length}`
  );

  return { finding, evidence };
}
