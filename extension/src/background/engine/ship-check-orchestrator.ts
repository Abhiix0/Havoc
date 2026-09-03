/**
 * ship-check-orchestrator.ts — sequential runner for the unified Ship Check workflow.
 *
 * Order Rationale:
 * 1. runtime_errors: Observed FIRST passively so any baseline uncaught exceptions
 *    or rejection errors already occurring on the clean page are captured before
 *    chaos injection can be blamed for pre-existing errors.
 * 2. fetch_latency: Gentle chaos injection (delays only) before hard failures.
 * 3. fetch_failure: Simulates network disconnects / 503 errors.
 * 4. input_stress: Injects edge-case input values into form fields.
 * 5. viewport_stress: Resizes layout boundaries to test responsive overflow.
 * 6. secret_scan: Analyzes client bundles and scripts LAST since fetching and
 *    scanning multiple external scripts may take more time.
 *
 * Sequential Constraint:
 * run-coordinator.ts and passive-check-runner.ts both enforce a strict module-level
 * singleton constraint (_registry, _abortController, getCurrentRun, getCurrentPassiveRun)
 * where only ONE active run/check may exist in the Service Worker at a time.
 * Therefore, Ship Check steps MUST execute strictly sequentially, with each step
 * fully reaching a terminal state before the next step is initiated.
 */

import type { Target } from '../../domain/target';
import type {
  ShipCheckRun,
  ShipCheckStep,
  ShipCheckStepKind,
} from '../../domain/ship-check';
import type { ExperimentDefinition } from '../../domain/experiment';
import type { PassiveCheckDefinition } from '../../domain/passive-check';
import type { Finding } from '../../domain/finding';
import { verifyTarget } from './safety-controller';
import { startRun } from './run-coordinator';
import { startPassiveCheck } from './passive-check-runner';
import { deriveRemediation } from './remediation-engine';
import { computeReadiness } from './readiness';
import {
  deriveFindingFromRuntimeErrors,
  deriveFindingFromSecretMatches,
} from './finding-engine';
import { createShipCheckStepUpdateMessage } from '../../messaging/messages';
import {
  saveShipCheck,
  saveFinding,
  saveAllEvidence,
  getFindingsByRunId,
  getEventsByRunId,
  getSignalsByRunId,
  getRecoveryByRunId,
  saveRemediation,
  applyShipCheckRetention,
} from '../../storage/repository';

export const SHIP_CHECK_STEPS: Array<{
  kind: ShipCheckStepKind;
  runner: 'experiment' | 'passive';
}> = [
  { kind: 'runtime_errors', runner: 'passive' },
  { kind: 'fetch_latency', runner: 'experiment' },
  { kind: 'fetch_failure', runner: 'experiment' },
  { kind: 'input_stress', runner: 'experiment' },
  { kind: 'viewport_stress', runner: 'experiment' },
  { kind: 'secret_scan', runner: 'passive' },
];

let _activeShipCheckId: string | null = null;

export function getActiveShipCheckId(): string | null {
  return _activeShipCheckId;
}

function broadcastShipCheckUpdate(shipCheck: ShipCheckRun): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  chrome.runtime.sendMessage(createShipCheckStepUpdateMessage(shipCheck)).catch(() => {
    // No popup open — expected
  });
}

function buildStepDefinition(
  kind: ShipCheckStepKind
): ExperimentDefinition | PassiveCheckDefinition {
  switch (kind) {
    case 'runtime_errors':
      return {
        id: crypto.randomUUID(),
        kind: 'runtime_errors',
        name: 'RUNTIME ERRORS',
        description: 'Capture uncaught exceptions and unhandled promise rejections on page',
        params: { observeMs: 5000 },
      };
    case 'fetch_latency':
      return {
        id: crypto.randomUUID(),
        kind: 'fetch_latency',
        name: 'LATENCY +800ms',
        description: 'Inject artificial 800ms latency into all outgoing fetch/XHR requests',
        params: {
          delayMs: 800,
          durationMs: 5000,
          recoveryWindowMs: 8000,
        },
      };
    case 'fetch_failure':
      return {
        id: crypto.randomUUID(),
        kind: 'fetch_failure',
        name: 'FAILURE (TRANSPORT_ERROR)',
        description: 'Simulate network failure mode: transport_error',
        params: {
          mode: 'transport_error',
          durationMs: 5000,
          recoveryWindowMs: 8000,
        },
      };
    case 'input_stress':
      return {
        id: crypto.randomUUID(),
        kind: 'input_stress',
        name: 'INPUT STRESS (ALL)',
        description: 'Inject stress inputs into input/textarea fields (all)',
        params: {
          mode: 'all',
          durationMs: 5000,
          recoveryWindowMs: 8000,
        },
      };
    case 'viewport_stress':
      return {
        id: crypto.randomUUID(),
        kind: 'viewport_stress',
        name: 'VIEWPORT (MOBILE_NARROW)',
        description: 'Apply layout stress constraints: mobile_narrow',
        params: {
          mode: 'mobile_narrow',
          durationMs: 5000,
          recoveryWindowMs: 8000,
        },
      };
    case 'secret_scan':
      return {
        id: crypto.randomUUID(),
        kind: 'secret_scan',
        name: 'SECRET SCAN',
        description: 'Scan client script tags for exposed API keys and credentials',
        params: {},
      };
  }
}

/**
 * Execute all 6 Ship Check steps in a deterministic sequential pipeline.
 * Evaluates readiness verdict and persists findings and remediations.
 */
export async function startShipCheck(target: Target): Promise<ShipCheckRun> {
  if (_activeShipCheckId !== null) {
    throw new Error(
      `Cannot start a new Ship Check — one is already running (${_activeShipCheckId})`
    );
  }

  const shipCheckId = crypto.randomUUID();
  _activeShipCheckId = shipCheckId;

  try {
    const steps: ShipCheckStep[] = SHIP_CHECK_STEPS.map((step) => ({
      kind: step.kind,
      runId: '',
      status: 'PENDING',
    }));

    const shipCheckRun: ShipCheckRun = {
      shipCheckId,
      target,
      steps,
      createdAt: Date.now(),
      readiness: 'UNKNOWN',
    };

  await saveShipCheck(shipCheckRun).catch((err: unknown) => {
    console.error('[HAVOC][ship-check] failed to persist initial state:', err);
  });
  broadcastShipCheckUpdate(shipCheckRun);

  for (let i = 0; i < SHIP_CHECK_STEPS.length; i++) {
    const stepDef = SHIP_CHECK_STEPS[i]!;
    const step = shipCheckRun.steps[i]!;

    // 1. Re-verify target
    const verification = await verifyTarget(shipCheckRun.target);
    if (!verification.ok) {
      console.warn(`[HAVOC][ship-check] target lost before step ${stepDef.kind}: ${verification.detail}`);
      for (let j = i; j < shipCheckRun.steps.length; j++) {
        shipCheckRun.steps[j]!.status = 'ERRORED';
      }
      await saveShipCheck(shipCheckRun).catch((err: unknown) => {
        console.error('[HAVOC][ship-check] failed to persist target lost state:', err);
      });
      broadcastShipCheckUpdate(shipCheckRun);
      break;
    }

    // 2. Mark step RUNNING
    step.status = 'RUNNING';
    await saveShipCheck(shipCheckRun).catch((err: unknown) => {
      console.error('[HAVOC][ship-check] failed to persist running step state:', err);
    });
    broadcastShipCheckUpdate(shipCheckRun);

    // 3. Build definition and run step
    const def = buildStepDefinition(stepDef.kind);
    let stepFailed = false;
    let stepRunId = '';

    try {
      if (stepDef.runner === 'passive') {
        const passiveRun = await startPassiveCheck(
          def as PassiveCheckDefinition,
          shipCheckRun.target
        );
        stepRunId = passiveRun.runId;
        step.runId = stepRunId;
        if (passiveRun.state === 'FAILED' || passiveRun.state === 'TARGET_LOST') {
          stepFailed = true;
        }
      } else {
        const expRun = await startRun(
          def as ExperimentDefinition,
          shipCheckRun.target
        );
        stepRunId = expRun.runId;
        step.runId = stepRunId;
        if (
          expRun.state === 'FAILED' ||
          expRun.state === 'TARGET_LOST' ||
          expRun.state === 'CLEANUP_FAILED'
        ) {
          stepFailed = true;
        }
      }
    } catch (err: unknown) {
      console.error(`[HAVOC][ship-check] step ${stepDef.kind} runner threw:`, err);
      stepFailed = true;
    }

    // 4. Update step status
    step.status = stepFailed ? 'ERRORED' : 'DONE';
    await saveShipCheck(shipCheckRun).catch((err: unknown) => {
      console.error('[HAVOC][ship-check] failed to persist step completion:', err);
    });
    broadcastShipCheckUpdate(shipCheckRun);

    // 4b. Derive and persist Findings for passive checks that completed successfully
    if (stepDef.runner === 'passive' && step.status === 'DONE' && stepRunId) {
      try {
        const stepEvents = await getEventsByRunId(stepRunId);
        const stepSignals = await getSignalsByRunId(stepRunId);
        const eventIndex = new Map(stepEvents.map((e) => [e.id, e]));
        const signalIndex = new Map(stepSignals.map((s) => [s.id, s]));

        let findingResult: { finding: Finding | null; evidence: import('../../domain/evidence').Evidence[] } | null = null;

        if (stepDef.kind === 'runtime_errors') {
          const errorEvents = stepEvents.filter(
            (e) => e.type === 'UNCAUGHT_EXCEPTION' || e.type === 'UNHANDLED_REJECTION'
          );
          const errorSignals = stepSignals.filter((s) => s.type === 'RuntimeErrorObserved');
          findingResult = deriveFindingFromRuntimeErrors(
            stepRunId,
            errorEvents,
            errorSignals,
            eventIndex,
            signalIndex,
            'runtime_errors'
          );
        } else if (stepDef.kind === 'secret_scan') {
          const matchEvents = stepEvents.filter((e) => e.type === 'SECRET_PATTERN_MATCH');
          const matchSignals = stepSignals.filter((s) => s.type === 'SecretPatternDetected');
          findingResult = deriveFindingFromSecretMatches(
            stepRunId,
            matchEvents,
            matchSignals,
            eventIndex,
            signalIndex,
            'secret_scan'
          );
        }

        if (findingResult) {
          if (findingResult.evidence.length > 0) {
            await saveAllEvidence(findingResult.evidence).catch((err: unknown) => {
              console.error('[HAVOC][ship-check] failed to persist passive evidence:', err);
            });
          }
          if (findingResult.finding) {
            await saveFinding(findingResult.finding).catch((err: unknown) => {
              console.error('[HAVOC][ship-check] failed to persist passive finding:', err);
            });
          }
        }
      } catch (fErr: unknown) {
        console.error(
          `[HAVOC][ship-check] failed to derive findings for passive step ${stepDef.kind}:`,
          fErr
        );
      }
    }

    // 5. Derive and save remediations for any findings produced by this step
    if (stepRunId) {
      try {
        const stepFindings = await getFindingsByRunId(stepRunId);
        const stepEvents = await getEventsByRunId(stepRunId);
        const stepSignals = await getSignalsByRunId(stepRunId);
        const stepRecovery = await getRecoveryByRunId(stepRunId);

        for (const finding of stepFindings) {
          const remediation = deriveRemediation(finding, {
            events: stepEvents,
            signals: stepSignals,
            recoveryOutcome: stepRecovery?.outcome,
          });
          await saveRemediation(remediation);
        }
      } catch (remErr: unknown) {
        console.error(
          `[HAVOC][ship-check] failed to derive/save remediations for step ${stepDef.kind}:`,
          remErr
        );
      }
    }
  }

    // Gather all findings across all step runIds
    const allFindings: Finding[] = [];
    for (const step of shipCheckRun.steps) {
      if (step.runId) {
        const findings = await getFindingsByRunId(step.runId);
        allFindings.push(...findings);
      }
    }

    const erroredStepCount = shipCheckRun.steps.filter((s) => s.status === 'ERRORED').length;
    shipCheckRun.readiness = computeReadiness(allFindings, erroredStepCount);
    shipCheckRun.completedAt = Date.now();

    await saveShipCheck(shipCheckRun).catch((err: unknown) => {
      console.error('[HAVOC][ship-check] failed to persist final ship check state:', err);
    });
    broadcastShipCheckUpdate(shipCheckRun);

    applyShipCheckRetention().catch((err: unknown) => {
      console.error('[HAVOC][ship-check] retention error:', err);
    });

    return shipCheckRun;
  } finally {
    _activeShipCheckId = null;
  }
}
