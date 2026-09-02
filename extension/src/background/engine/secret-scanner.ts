/**
 * secret-scanner.ts — PassiveCheckExecutor implementation for secret exposure check.
 *
 * Injects script content collector via chrome.scripting.executeScript,
 * scans collected scripts for known sensitive patterns, redacts all matches,
 * and emits SECRET_PATTERN_MATCH HavocEvents.
 */

import type { PassiveCheckExecutor } from './passive-check-runner';
import type { HavocEvent } from '../../domain/event';
import { scanForSecrets } from '../../shared/secret-patterns';
import { redactMatch } from '../../shared/redact';
import { sanitizeUrl } from '../../shared/sanitize-url';

export interface CollectedScriptChunk {
  sourceDescription: string;
  text: string;
}

/**
 * Serializable collector function executed in the page context.
 * Collects text from inline scripts, inline JSON scripts, and same-origin external scripts.
 * Must NOT reference any outer closure variables or imports.
 */
export async function collectPageScriptText(): Promise<CollectedScriptChunk[]> {
  const results: CollectedScriptChunk[] = [];
  const MAX_TOTAL_CHARS = 2_000_000;
  let currentTotalChars = 0;

  const scripts = Array.from(document.querySelectorAll('script'));

  for (const script of scripts) {
    if (currentTotalChars >= MAX_TOTAL_CHARS) break;

    const src = script.getAttribute('src');
    const type = script.getAttribute('type') || '';

    if (!src) {
      const isJson = type.toLowerCase() === 'application/json';
      const sourceDescription = isJson
        ? 'inline JSON script tag'
        : 'inline <script> tag';
      const rawText = script.textContent ?? '';

      if (rawText.length > 0) {
        const remainingSpace = MAX_TOTAL_CHARS - currentTotalChars;
        const text =
          rawText.length > remainingSpace
            ? rawText.slice(0, remainingSpace)
            : rawText;
        results.push({ sourceDescription, text });
        currentTotalChars += text.length;
      }
    } else {
      try {
        const scriptUrl = new URL(src, window.location.href);
        if (scriptUrl.origin === window.location.origin) {
          const response = await fetch(scriptUrl.href);
          if (response.ok) {
            const rawText = await response.text();
            if (rawText.length > 0) {
              const remainingSpace = MAX_TOTAL_CHARS - currentTotalChars;
              const text =
                rawText.length > remainingSpace
                  ? rawText.slice(0, remainingSpace)
                  : rawText;
              results.push({
                sourceDescription: `external script: ${scriptUrl.href}`,
                text,
              });
              currentTotalChars += text.length;
            }
          }
        }
      } catch {
        // Best-effort; swallow individual fetch failures
      }
    }
  }

  return results;
}

export const secretScannerExecutor: PassiveCheckExecutor = async (
  target,
  _definition,
  runId,
  nextSequence
) => {
  let chunks: CollectedScriptChunk[] = [];

  if (typeof chrome !== 'undefined' && chrome.scripting?.executeScript) {
    try {
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: target.tabId },
        func: collectPageScriptText,
      });

      if (Array.isArray(injectionResults) && injectionResults.length > 0) {
        const firstResult = injectionResults[0]?.result;
        if (Array.isArray(firstResult)) {
          chunks = firstResult as CollectedScriptChunk[];
        }
      }
    } catch (err: unknown) {
      console.warn(
        `[HAVOC][secret-scanner] failed to executeScript in tab ${target.tabId}:`,
        err
      );
    }
  }

  const events: HavocEvent[] = [];
  const seenMatches = new Set<string>();
  const MAX_EVENTS = 200;

  for (const chunk of chunks) {
    if (events.length >= MAX_EVENTS) break;

    const matches = scanForSecrets(chunk.text);

    for (const match of matches) {
      if (events.length >= MAX_EVENTS) break;

      // SAFETY-CRITICAL: Redact immediately before storing or processing
      const redacted = redactMatch(match.rawMatch);
      const dedupKey = `${match.patternId}:${redacted}`;

      if (seenMatches.has(dedupKey)) {
        continue;
      }
      seenMatches.add(dedupKey);

      let formattedSourceDescription = chunk.sourceDescription;
      if (chunk.sourceDescription.startsWith('external script: ')) {
        const rawUrl = chunk.sourceDescription.slice('external script: '.length);
        formattedSourceDescription = `external script: ${sanitizeUrl(rawUrl)}`;
      }

      events.push({
        id: crypto.randomUUID(),
        runId,
        timestamp: Date.now(),
        sequence: nextSequence(runId),
        type: 'SECRET_PATTERN_MATCH',
        source: 'service_worker',
        metadata: {
          patternId: match.patternId,
          label: match.label,
          severity: match.severity,
          redacted,
          sourceDescription: formattedSourceDescription,
        },
      });
    }
  }

  return { events };
};
