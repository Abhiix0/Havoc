import { writable, derived } from 'svelte/store';
import type { ShipCheckRun } from '../../../domain/ship-check';
import type { Finding } from '../../../domain/finding';
import type { Remediation } from '../../../domain/remediation';
import type { Target } from '../../../domain/target';
import { createCreateShipCheckMessage } from '../../../messaging/messages';
import { isShipCheckStepUpdateMessage } from '../../../messaging/validator';
import {
  getShipCheck,
  getFindingsByRunId,
  getRemediationsByFindingId,
} from '../../../storage/repository';

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export const currentShipCheck = writable<ShipCheckRun | null>(null);
export const shipCheckLoading = writable<boolean>(false);
export const shipCheckError = writable<string | null>(null);

export const isShipCheckActive = derived(
  currentShipCheck,
  ($sc) => $sc !== null && $sc.completedAt === undefined
);

// ---------------------------------------------------------------------------
// Message Handler
// ---------------------------------------------------------------------------

export function handleShipCheckMessage(message: unknown): void {
  if (isShipCheckStepUpdateMessage(message)) {
    currentShipCheck.set(message.shipCheck);
  }
}

// ---------------------------------------------------------------------------
// Store Operations
// ---------------------------------------------------------------------------

export async function resolveActiveTabTarget(): Promise<Target | undefined> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id !== undefined && tab.url) {
      let origin = '';
      try {
        origin = new URL(tab.url).origin;
      } catch {
        origin = tab.url;
      }
      return { tabId: tab.id, origin, url: tab.url, frameId: 0 };
    }
  } catch (e) {
    console.warn('[HAVOC][ship-check-store] could not resolve active tab', e);
  }
  return undefined;
}

export async function startShipCheck(): Promise<boolean> {
  shipCheckLoading.set(true);
  shipCheckError.set(null);

  try {
    const target = await resolveActiveTabTarget();
    const response = await chrome.runtime.sendMessage(
      createCreateShipCheckMessage(target)
    );

    if (response && typeof response === 'object' && 'error' in response && response.error) {
      shipCheckError.set(String(response.error));
      shipCheckLoading.set(false);
      return false;
    }

    shipCheckLoading.set(false);
    return true;
  } catch (e) {
    shipCheckError.set(e instanceof Error ? e.message : 'Failed to start Ship Check');
    shipCheckLoading.set(false);
    return false;
  }
}

export async function loadShipCheck(shipCheckId: string): Promise<{
  shipCheck?: ShipCheckRun | undefined;
  findings: Finding[];
  remediations: Remediation[];
}> {
  const shipCheck = await getShipCheck(shipCheckId);
  const findings: Finding[] = [];
  const remediations: Remediation[] = [];

  if (shipCheck) {
    for (const step of shipCheck.steps) {
      if (step.runId) {
        const stepFindings = await getFindingsByRunId(step.runId);
        findings.push(...stepFindings);

        for (const finding of stepFindings) {
          const stepRemediations = await getRemediationsByFindingId(finding.id);
          remediations.push(...stepRemediations);
        }
      }
    }
  }

  return { shipCheck, findings, remediations };
}

export function setupShipCheckStore(): () => void {
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(handleShipCheckMessage);
  }

  return () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.removeListener(handleShipCheckMessage);
    }
  };
}
