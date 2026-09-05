import type { ShipCheckRun } from './ship-check';
import type { Finding } from './finding';
import type { Remediation } from './remediation';
import type { Evidence } from './evidence';

export interface SyncEvidencePayload {
  kind: string;
  refId: string;
  capturedAt: number;
}

export interface SyncRemediationPayload {
  title: string;
  whatHappened: string;
  whyItMatters: string;
  howToFix: string[];
  fixPrompt: string;
}

export interface SyncFindingPayload {
  clientFindingId: string;
  checkKind?: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  confidence: number;
  description: string;
  evidence: SyncEvidencePayload[];
  remediation?: SyncRemediationPayload;
}

export interface SyncStepPayload {
  kind: string;
  status: 'DONE' | 'ERRORED' | 'SKIPPED';
  ordinal: number;
}

export interface SyncShipCheckPayload {
  clientShipCheckId: string;
  targetOrigin: string;
  readiness: 'READY' | 'NEEDS_ATTENTION' | 'BLOCKED' | 'UNKNOWN';
  createdAt: number;
  completedAt: number;
  steps: SyncStepPayload[];
  findings: SyncFindingPayload[];
}

export function buildSyncPayload(
  shipCheck: ShipCheckRun,
  findings: Finding[],
  remediations: Remediation[],
  evidenceByFindingId: Map<string, Evidence[]>
): SyncShipCheckPayload {
  if (shipCheck.completedAt === undefined) {
    throw new Error('Cannot build sync payload for an incomplete Ship Check (completedAt is undefined)');
  }

  const steps: SyncStepPayload[] = shipCheck.steps.map((step, ordinal) => {
    if (step.status === 'PENDING' || step.status === 'RUNNING') {
      throw new Error(`Cannot build sync payload with non-terminal step status: ${step.status}`);
    }
    return {
      kind: step.kind,
      status: step.status,
      ordinal,
    };
  });

  const remediationMap = new Map<string, Remediation>();
  for (const r of remediations) {
    remediationMap.set(r.findingId, r);
  }

  // Note for secret_scan findings: description and remediation fields are ALREADY
  // fully redacted upstream (by secret-scanner.ts and redact.ts). This function
  // does not perform redaction itself; it forwards already-safe strings without
  // adding a second redaction pass.
  const syncFindings: SyncFindingPayload[] = findings.map((finding) => {
    const rawEvidence = evidenceByFindingId.get(finding.id) ?? [];
    const syncEvidence: SyncEvidencePayload[] = rawEvidence.map((ev) => ({
      kind: ev.kind,
      refId: ev.refId,
      capturedAt: ev.capturedAt,
    }));

    const rawRemediation = remediationMap.get(finding.id);
    let syncRemediation: SyncRemediationPayload | undefined = undefined;
    if (rawRemediation) {
      syncRemediation = {
        title: rawRemediation.title,
        whatHappened: rawRemediation.whatHappened,
        whyItMatters: rawRemediation.whyItMatters,
        howToFix: rawRemediation.howToFix,
        fixPrompt: rawRemediation.fixPrompt,
      };
    }

    const payload: SyncFindingPayload = {
      clientFindingId: finding.id,
      ...(finding.checkKind !== undefined && { checkKind: finding.checkKind }),
      severity: finding.severity,
      confidence: finding.confidence,
      description: finding.description,
      evidence: syncEvidence,
      ...(syncRemediation !== undefined && { remediation: syncRemediation }),
    };

    return payload;
  });

  return {
    clientShipCheckId: shipCheck.shipCheckId,
    targetOrigin: shipCheck.target.origin,
    readiness: shipCheck.readiness,
    createdAt: shipCheck.createdAt,
    completedAt: shipCheck.completedAt,
    steps,
    findings: syncFindings,
  };
}
