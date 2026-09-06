# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-09-06

### Added
- **Chrome Manifest V3 Extension**: In-browser resilience testing engine operating locally via IndexedDB storage (`havoc_db`) without mandatory external dependencies.
- **Six Ship Checks**:
  - `fetch_failure`: Testing API failures (simulates network transport errors, timeouts, and synthetic 500/503 responses).
  - `fetch_latency`: Testing slow API responses (injects controlled 2.5s–3.0s delays to evaluate loading indicator feedback).
  - `input_stress`: Testing form inputs (fuzzes text inputs and select elements with extreme strings, unicode, and emojis).
  - `runtime_errors`: Checking for runtime errors (passively intercepts unhandled JavaScript exceptions and promise rejections).
  - `secret_scan`: Scanning for exposed secrets (inspects client DOM and script tags for leaked API tokens and private keys).
  - `viewport_stress`: Testing narrow screens (applies mobile width constraints to detect horizontal layout overflow).
- **Evidence-Driven Pipeline**: Strict four-tier reasoning chain (`Event → Signal → Finding → Recovery → Remediation`) with provenance tracking, confidence scoring (0.00–1.00), and causal lookback windows.
- **Deterministic Remediation Engine**: Zero-LLM, rule-based fix prompt generator producing structured guidance and copy-pasteable instructions for AI coding assistants directly from captured runtime evidence.
- **Structured Autopsy View**: Six-part investigative breakdown for every finding: What Happened, What Your App Did, Why It Matters, How To Fix It, Fix Prompt, and Technical Evidence.
- **Go REST API & PostgreSQL Sync**: Optional backend (`havoc-api`) using Chi router and PostgreSQL 16 with automatic migrations to persist project registries and Ship Check audit runs.
- **Demo Benchmark Application**: Node.js target web app (`demo-app/`) with togglable broken and fixed benchmark modes exercising all six resilience flaws.
- **Svelte 4 Popup Interface**: Multi-screen UI with state-reactive mascot animation covering Home, Experiment Select, Configure, Running, Results, Autopsy, and History views.
- **Docker Compose Environment**: Orchestration configuration running PostgreSQL 16 and `havoc-api` with health checks and volume persistence.

### Fixed
- **Content script failed to load on any target tab**: `chrome.scripting.executeScript` requires classic (non-module) scripts, but Vite emitted an ES module containing `import` statements; resolved by bundling `content-script.ts` as a standalone IIFE classic script via `esbuild`.
- **Page bridge script crashed on injection**: Shared chunk imports (`validator`, `sanitize-url`) split out by Rollup were blocked by Chrome's `web_accessible_resources` enforcement; resolved by isolating `bridge.ts` from Rollup input and bundling it as a fully self-contained IIFE with zero external imports.
- **Cross-tab observation contamination**: Observations from unrelated tabs could be misattributed to the active run; resolved by strictly validating `sender.tab.id` against the active run's target tab ID before accepting observations in the service worker.
- **Unrelated network failures triggered false-positive findings**: Third-party network drops (ads, analytics) during non-network checks (`input_stress`, `viewport_stress`) generated spurious findings; resolved by gating signal derivation on causal plausibility (experiment kind awareness and target same-origin matching).
- **Broken experiment startup stranded the user**: Failed initialization left the UI stuck on an active screen with a non-responsive abort button; resolved by only navigating forward on confirmed successful run creation.
- **Abort command failed once an experiment passed the active state**: Aborting during cleanup hung indefinitely; resolved by threading the abort signal through resource cleanup and recovery windows with 5000ms per-resource timeouts.
- **Suspended service worker caused permanent run hangs**: Service worker termination under Manifest V3 left runs in non-terminal states; resolved by adding a `chrome.alarms`-backed watchdog that detects stale runs and force-terminates them to terminal states.
- **Sensitive URL parameters leaked to storage**: Raw query parameters (tokens, session IDs) were stored unredacted; resolved by applying a `sanitize-url` boundary at the earliest point of observation.
- **Home screen displayed unverified capability badges**: UI displayed fabricated detection badges implying runtime verification that had not occurred; corrected to display only verifiable facts (`TOP-LEVEL` or `STANDBY`).
- **Demo app crashed with syntax errors when opened via filesystem**: The `%%APP_CONFIG_JSON%%` template tag was not replaced when opening `index.html` outside `server.js`; added a safe fallback and clearer server startup documentation.

### Changed
- **Product Repositioning**: Reframed the core product identity from a generic browser chaos-engineering experimenter to a targeted pre-ship audit tool for AI-generated ("vibe-coded") web applications, introducing Ship Check workflows and readiness verdicts (`READY`, `NEEDS_ATTENTION`, `BLOCKED`, `UNKNOWN`) while preserving the underlying evidence engine.
- **Popup UI Architecture**: Migrated from an early dense single-screen CRT dashboard prototype to a structured, modular multi-screen navigation flow (Home → Select → Configure → Running → Results → Autopsy → History).
