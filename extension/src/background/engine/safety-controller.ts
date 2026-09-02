/**
 * safety-controller.ts — verifies the experiment target is still valid
 * before the run is allowed to enter the ACTIVE state.
 *
 * Why between PREPARING and ACTIVE specifically:
 *   PREPARING is when the coordinator sets up resources and instruments the
 *   page. Only once preparation is complete does it make sense to check the
 *   target, because:
 *     - Checking too early (before PREPARING) is wasteful — tab state can
 *       change during preparation itself.
 *     - Checking after ACTIVE would mean chaos has already started on a tab
 *       that may have navigated to a different origin, violating the scope
 *       contract ("never silently expand scope to a different target").
 *   The gap between PREPARING completing and the ACTIVE transition is the
 *   last safe moment to abort without having caused any harmful side-effects.
 */

import type { Target } from '../../domain/target';

// TAB_ID_MISMATCH was removed as dead code: verifyTarget fetches the tab using
// chrome.tabs.get(target.tabId), so any found tab is guaranteed to match target.tabId.
export type TargetVerificationResult =
  | { ok: true }
  | { ok: false; reason: 'TAB_NOT_FOUND' | 'ORIGIN_MISMATCH' | 'TAB_LOADING'; detail: string };

/**
 * Verify that the tab described by `target` still exists, is still on the
 * same origin, and has finished loading.
 *
 * Returns { ok: true } when safe to proceed to ACTIVE.
 * Returns { ok: false, reason, detail } when the run must abort to TARGET_LOST.
 */
export async function verifyTarget(target: Target): Promise<TargetVerificationResult> {
  let tab: chrome.tabs.Tab;

  try {
    tab = await chrome.tabs.get(target.tabId);
  } catch {
    return {
      ok: false,
      reason: 'TAB_NOT_FOUND',
      detail: `Tab ${target.tabId} no longer exists`,
    };
  }

  // Tab must be fully loaded before we inject chaos — a still-loading tab
  // will have its DOM torn down mid-preparation.
  if (tab.status === 'loading') {
    return {
      ok: false,
      reason: 'TAB_LOADING',
      detail: `Tab ${target.tabId} is still loading (url: ${tab.url ?? 'unknown'})`,
    };
  }

  // Verify the tab's current URL is still on the same origin as when the
  // run was created. Navigation to a different origin is a scope violation.
  const currentUrl = tab.url ?? '';
  let currentOrigin: string;

  try {
    currentOrigin = new URL(currentUrl).origin;
  } catch {
    return {
      ok: false,
      reason: 'ORIGIN_MISMATCH',
      detail: `Tab ${target.tabId} has an unparseable URL: "${currentUrl}"`,
    };
  }

  if (currentOrigin !== target.origin) {
    return {
      ok: false,
      reason: 'ORIGIN_MISMATCH',
      detail: `Tab ${target.tabId} navigated from "${target.origin}" to "${currentOrigin}"`,
    };
  }

  return { ok: true };
}
