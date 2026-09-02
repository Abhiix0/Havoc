/**
 * remediation-engine.ts — deterministic, rule-based remediation generator.
 *
 * Generates plain-language user guidance and copyable AI-coding-tool fix prompts
 * directly from findings and captured evidence without any LLM API dependencies.
 */

import type { Finding } from '../../domain/finding';
import type { HavocEvent } from '../../domain/event';
import type { Signal } from '../../domain/signal';
import type { Recovery } from '../../domain/recovery';
import type { Remediation } from '../../domain/remediation';

export interface RemediationContext {
  events: HavocEvent[];
  signals: Signal[];
  recoveryOutcome?: Recovery['outcome'] | undefined;
}

export function deriveRemediation(
  finding: Finding,
  context: RemediationContext = { events: [], signals: [] }
): Remediation {
  const { events = [], recoveryOutcome } = context;

  switch (finding.checkKind) {
    case 'fetch_failure':
    case 'fetch_latency': {
      const isDegraded =
        recoveryOutcome === 'DEGRADED' ||
        finding.description.toLowerCase().includes('degraded');

      const failureEvents = events.filter((e) =>
        [
          'REQUEST_TRANSPORT_FAILURE',
          'REQUEST_HTTP_FAILURE',
          'REQUEST_TIMEOUT',
        ].includes(e.type)
      );

      const endpointDetails = failureEvents
        .slice(0, 3)
        .map((e) => {
          const status = e.metadata?.status ? ` (status ${e.metadata.status})` : '';
          const resource = e.resource ? ` to ${e.resource}` : '';
          return `Network request${resource} failed${status}.`;
        });

      if (endpointDetails.length === 0) {
        endpointDetails.push(
          'Network requests failed or timed out during test execution.'
        );
      }

      if (isDegraded) {
        const title = "Your app's retry and recovery flow is incomplete";
        const whatHappened =
          'When network delays or failures occurred, your application cleared loading indicators but did not successfully display recovered data.';
        const whyItMatters =
          'Users are left viewing empty or stale states after transient network hiccups, without realizing the latest request failed to complete.';
        const howToFix = [
          'Implement exponential backoff retry for failed API requests.',
          'Cache previously fetched data to serve as an offline or fallback state.',
          'Display an inline banner or indicator when viewing cached/stale data.',
          'Provide a manual "Refresh" or "Retry" action in the UI.',
        ];
        const fixPrompt = `Fix the recovery and retry flow in the network data-fetching layer.

HAVOC observed:
${endpointDetails.map((b) => `- ${b}`).join('\n')}
- Loading indicators cleared without successfully resolving fresh data.

Implement robust retry, caching, and fallback logic, while preserving existing working behavior.

Verify that:
- Transient network failures automatically trigger backoff retries.
- Cached or fallback UI is shown when fresh data cannot be loaded.
- The UI clearly indicates stale or offline status.`;

        return {
          id: crypto.randomUUID(),
          findingId: finding.id,
          runId: finding.runId,
          title,
          whatHappened,
          whyItMatters,
          howToFix,
          fixPrompt,
        };
      }

      // FAILED outcome
      const title = "Your app doesn't handle API failures";
      const whatHappened =
        'When network requests failed, your application remained in an unrecovered error state without presenting a retry option or recovery UI to the user.';
      const whyItMatters =
        'When backend endpoints experience hiccups or outages, users are stranded on broken or frozen screens without knowing what went wrong or how to continue.';
      const howToFix = [
        'Add a visible error boundary or error notification banner when network requests fail.',
        'Provide a clear "Try Again" or "Retry" button that re-executes the failed query.',
        'Ensure loading spinners and disabled button states are cleanly reset on error.',
        'Log detailed failure telemetry to your error tracking service.',
      ];
      const fixPrompt = `Fix the API error handling in the network data-fetching layer.

HAVOC observed:
${endpointDetails.map((b) => `- ${b}`).join('\n')}
- No recovery indicator or successful retry was observed within the recovery window.
- The application UI did not clear error states.

Implement user-facing error states with a retry mechanism, while preserving existing working behavior.

Verify that:
- A user-friendly error UI is displayed when requests fail.
- The user can click a retry button to re-attempt the request.
- Loading spinners are dismissed on failure.`;

      return {
        id: crypto.randomUUID(),
        findingId: finding.id,
        runId: finding.runId,
        title,
        whatHappened,
        whyItMatters,
        howToFix,
        fixPrompt,
      };
    }

    case 'input_stress': {
      const title = "Your forms don't handle edge-case input values";
      const whatHappened =
        'When input fields received rapid typing, special characters, or extreme boundary values, the page experienced unexpected state changes or unhandled errors.';
      const whyItMatters =
        'Malformed input, rapid keystrokes, or unexpected characters can crash client components or corrupt local form state.';
      const howToFix = [
        'Add client-side schema validation (e.g. Zod, Yup) on form inputs before state updates.',
        'Debounce rapid input events on search and filter fields.',
        'Sanitize and clamp string lengths and numerical boundaries.',
        'Display inline field validation errors instead of throwing unhandled exceptions.',
      ];
      const fixPrompt = `Fix the form input validation and sanitization in the form handling components.

HAVOC observed:
- Form input stress injection caused unexpected state or unhandled failures.
- Inputs with extreme boundaries or special characters were not handled gracefully.

Implement comprehensive client-side schema validation and input sanitization, while preserving existing working behavior.

Verify that:
- Invalid inputs display clear inline validation messages.
- Oversized or malformed inputs are rejected or sanitized before state updates.
- Submitting edge-case inputs does not crash the UI.`;

      return {
        id: crypto.randomUUID(),
        findingId: finding.id,
        runId: finding.runId,
        title,
        whatHappened,
        whyItMatters,
        howToFix,
        fixPrompt,
      };
    }

    case 'viewport_stress': {
      const title = 'Your layout has responsive and viewport overflow issues';
      const whatHappened =
        'When viewport dimensions were adjusted to constrained or mobile widths, layout constraints were challenged.';
      const whyItMatters =
        'Content that overflows offscreen or overlaps on smaller viewports makes interactive controls unreachable and degrades user experience.';
      const howToFix = [
        'Use fluid layouts with CSS Flexbox or Grid and defined breakpoints.',
        'Ensure containers specify appropriate overflow containment (e.g. overflow-x: auto).',
        'Verify interactive buttons and links maintain minimum 44px tap targets on mobile.',
      ];
      const fixPrompt = `Fix the responsive layout and overflow handling in the page layout components.

HAVOC observed:
- Viewport stress testing revealed layout constraints on constrained screens.

Implement responsive breakpoints and overflow containment, while preserving existing working behavior.

Verify that:
- Content fits within narrow viewport widths without horizontal scrolling.
- Text and buttons do not clip or overlap.
- Interactive controls remain accessible and tappable on mobile screen sizes.`;

      return {
        id: crypto.randomUUID(),
        findingId: finding.id,
        runId: finding.runId,
        title,
        whatHappened,
        whyItMatters,
        howToFix,
        fixPrompt,
      };
    }

    case 'runtime_errors': {
      const errorEvents = events.filter((e) =>
        ['UNCAUGHT_EXCEPTION', 'UNHANDLED_REJECTION'].includes(e.type)
      );

      const errorBullets = errorEvents.slice(0, 4).map((e) => {
        const msg = (e.metadata?.message as string | undefined) || 'Uncaught exception';
        const file = (e.metadata?.filename as string | undefined)
          ? ` in ${e.metadata?.filename}`
          : '';
        const line = typeof e.metadata?.lineno === 'number' ? `:${e.metadata.lineno}` : '';
        return `Uncaught error${file}${line}: "${msg.slice(0, 150)}"`;
      });

      if (errorBullets.length === 0) {
        errorBullets.push(
          'Uncaught exceptions or unhandled promise rejections were observed during execution.'
        );
      }

      const title = 'Your page has uncaught JavaScript errors';
      const whatHappened = `Uncaught runtime errors occurred during page execution: ${errorBullets.join('; ')}`;
      const whyItMatters =
        'Uncaught JavaScript errors stop execution in affected script blocks, breaking user interactivity, forms, and navigation.';
      const howToFix = [
        'Add optional chaining (?.) and null checks before accessing nested object properties.',
        'Wrap asynchronous operations in try/catch blocks or attach .catch() handlers to Promises.',
        'Introduce React/Svelte/Vue Error Boundaries around key component trees.',
        'Check browser console for stack traces pointing to the offending source lines.',
      ];
      const fixPrompt = `Fix the uncaught runtime errors in the client application.

HAVOC observed:
${errorBullets.map((b) => `- ${b}`).join('\n')}

Implement proper null-checking, error boundaries, and asynchronous exception handling, while preserving existing working behavior.

Verify that:
- The identified runtime exceptions no longer occur.
- Asynchronous promises have rejection handlers.
- The UI remains responsive when unexpected data is encountered.`;

      return {
        id: crypto.randomUUID(),
        findingId: finding.id,
        runId: finding.runId,
        title,
        whatHappened,
        whyItMatters,
        howToFix,
        fixPrompt,
      };
    }

    case 'secret_scan': {
      const secretEvents = events.filter(
        (e) => e.type === 'SECRET_PATTERN_MATCH'
      );

      const secretBullets = secretEvents.slice(0, 4).map((e) => {
        const label = (e.metadata?.label as string | undefined) || 'API credential';
        const source = (e.metadata?.sourceDescription as string | undefined)
          ? ` in ${e.metadata?.sourceDescription}`
          : '';
        return `Potential ${label} detected${source}`;
      });

      if (secretBullets.length === 0) {
        secretBullets.push(
          'Client-accessible scripts contained patterns matching sensitive credentials.'
        );
      }

      const title = 'Exposed API keys or secrets detected in client scripts';
      const whatHappened =
        'Client-accessible script tags on your page contain patterns matching sensitive credentials or API keys.';
      const whyItMatters =
        'Secrets embedded in frontend bundles or scripts are visible to anyone inspecting network traffic or page source, risking account compromise and unauthorized access.';
      const howToFix = [
        'Immediately revoke and rotate the exposed credentials in your provider console.',
        'Move sensitive API keys and tokens to backend environment variables.',
        'Proxy external service requests through an authenticated backend API endpoint.',
        'Add pre-commit hooks (e.g. gitleaks, git-secrets) to prevent secret commits in the future.',
      ];
      const fixPrompt = `Remove exposed credentials and move API calls to a secure backend proxy.

HAVOC observed:
${secretBullets.map((b) => `- ${b}`).join('\n')}
- Sensitive credentials were found embedded in client-accessible script content.

Rotate the exposed credential immediately and refactor client code to access the service through an authenticated server endpoint or environment variables, while preserving existing working behavior.

Verify that:
- The exposed secret is revoked and replaced with a new credential.
- No private keys or sensitive API tokens remain in client-side bundles or scripts.
- The frontend communicates with a backend proxy rather than storing secrets directly.`;

      return {
        id: crypto.randomUUID(),
        findingId: finding.id,
        runId: finding.runId,
        title,
        whatHappened,
        whyItMatters,
        howToFix,
        fixPrompt,
      };
    }

    default: {
      const title = 'Review application resilience finding';
      const whatHappened = finding.description;
      const whyItMatters =
        'Addressing observed resilience weaknesses ensures reliable user experience under degraded conditions.';
      const howToFix = [
        'Review the recorded evidence and reproduction steps in the finding details.',
        'Identify root cause in affected frontend or backend components.',
        'Implement defensive error handling and re-run HAVOC checks to verify.',
      ];
      const fixPrompt = `Fix the issue identified by HAVOC.

HAVOC observed:
- ${finding.description}

Implement the necessary error handling and recovery fixes, while preserving existing working behavior.

Verify that:
- The issue is resolved without breaking existing functionality.`;

      return {
        id: crypto.randomUUID(),
        findingId: finding.id,
        runId: finding.runId,
        title,
        whatHappened,
        whyItMatters,
        howToFix,
        fixPrompt,
      };
    }
  }
}
