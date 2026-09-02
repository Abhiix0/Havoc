# HAVOC

### Break the running application. Study how it survives.

HAVOC is an **evidence-driven browser resilience testing tool** that injects controlled failures into running web applications, observes their behavior, and produces evidence-backed findings about failure handling and recovery.

Instead of writing a test first and hoping the application behaves correctly, HAVOC takes a different approach:

```text
Running Application
        ↓
   Controlled Failure
        ↓
      Observe
        ↓
      Evidence
        ↓
       Signals
        ↓
      Recovery
        ↓
      Autopsy
```

The question isn't simply:

> **"Did the application fail?"**

It's:

> **"When something failed, did the application detect it, communicate it, and recover correctly?"**

---

## Why HAVOC?

Modern applications are usually tested under healthy conditions.

Requests succeed.

Servers respond.

Networks behave.

Users enter reasonable input.

But production systems don't live in that universe.

```text
Network timeout
API failure
Slow request
Unexpected input
Layout pressure
Runtime error
```

These failures expose a different class of bugs:

* loading states that never disappear
* missing error messages
* broken retry behavior
* silent failures
* unusable degraded states
* UI corruption
* incomplete recovery
* inconsistent application state

HAVOC deliberately introduces controlled failures and investigates what happens next.

---

# Core Thesis

HAVOC is not primarily a "chaos monkey for Chrome."

Its purpose is:

> **To test whether an application can detect, communicate, and recover from controlled failure.**

The core product loop is:

```text
INJECT
   ↓
OBSERVE
   ↓
EVIDENCE
   ↓
DETECT
   ↓
RECOVER
   ↓
EXPLAIN
```

The valuable part isn't the failure injection itself.

Anyone can delay a `fetch()` call.

The interesting system is the pipeline that turns:

```text
Controlled Failure
        ↓
Causal Event Stream
        ↓
Behavioral Signals
        ↓
Evidence
        ↓
Recovery Analysis
        ↓
Actionable Finding
```

---

# Example

Suppose a page requests:

```text
GET /api/projects
```

HAVOC injects a controlled 3-second delay.

The application enters a loading state.

The request eventually succeeds.

HAVOC observes:

```text
REQUEST_STARTED
CHAOS_INJECTED
LOADING_STATE_DETECTED
REQUEST_COMPLETED
LOADING_STATE_EXITED
RECOVERY_COMPLETED
```

The result:

```text
🟢 RECOVERED

The application tolerated the injected latency
and returned to an observable stable state.
```

Now imagine the request fails:

```text
REQUEST_STARTED
CHAOS_INJECTED
REQUEST_FAILED
LOADING_STATE_DETECTED
...
RECOVERY_WINDOW_EXPIRED
```

HAVOC may produce:

```text
🔴 FINDING

Potential missing failure recovery

Evidence:
- request failed
- loading state persisted
- no observable error state
- recovery window expired

Confidence: 0.91
```

The important rule is:

> **Every finding must be explainable from evidence.**

---

# Architecture

HAVOC is designed as a bounded experimental system.

```text
                         HAVOC
                           │
                           ▼
                  ┌─────────────────┐
                  │ Run Coordinator │
                  └────────┬────────┘
                           │
                ┌──────────┼──────────┐
                ▼          ▼          ▼
             Safety     Experiment   State
            Controller    Engine    Machine
                           │
                           ▼
                    Resource Registry
                           │
                           ▼
                      Runtime Adapter
                           │
                 ┌─────────┴─────────┐
                 ▼                   ▼
           Content Script          Page World
                 │                   │
                 │              Instrumentation
                 │                   │
                 └─────────┬─────────┘
                           ▼
                      Event Buffer
                           │
                           ▼
                      Signal Engine
                           │
                           ▼
                     Recovery Window
                           │
                           ▼
                      Finding Engine
                           │
                    ┌──────┴──────┐
                    ▼             ▼
                 Evidence      Recovery
                    │             │
                    └──────┬──────┘
                           ▼
                         Report
                           │
                           ▼
                       IndexedDB
```

---

# Runtime Architecture

HAVOC V1 runs as a Chrome Manifest V3 extension.

The browser execution model is intentionally split into isolated responsibilities.

```text
┌─────────────────────────────────────┐
│ Extension Service Worker            │
│                                     │
│ Run coordination                    │
│ State persistence                   │
│ Message routing                     │
│ Experiment orchestration            │
│ Safety enforcement                  │
└───────────────┬─────────────────────┘
                │ chrome.runtime
                ▼
┌─────────────────────────────────────┐
│ Content Script                       │
│                                     │
│ Target detection                    │
│ DOM observation                     │
│ Bridge relay                        │
│ UI communication                    │
└───────────────┬─────────────────────┘
                │ window.postMessage
                ▼
┌─────────────────────────────────────┐
│ PAGE WORLD                           │
│                                     │
│ fetch instrumentation               │
│ XHR instrumentation                 │
│ Runtime instrumentation             │
│ Experiment hooks                    │
└─────────────────────────────────────┘
```

The popup is only a control surface.

It does **not** own experiment state.

If the popup closes, the experiment must continue.

---

# Domain Model

HAVOC's core domain is intentionally small.

```text
Target
ExperimentDefinition
ExperimentRun
ExperimentState
ResourceRegistry
Event
Signal
Finding
Evidence
Recovery
```

The most important distinction is:

```text
EVENT ≠ SIGNAL ≠ FINDING
```

### Event

A raw observation.

```text
REQUEST_COMPLETED
```

### Signal

An interpretation derived from observations.

```text
PotentialErrorStateDetected
```

### Finding

An evidence-backed conclusion.

```text
Application may not recover from failed request
```

This separation allows HAVOC to evolve its analysis without corrupting the original observations.

---

# Experiment Lifecycle

Every experiment follows a controlled lifecycle:

```text
CREATED
   ↓
PREPARING
   ↓
ACTIVE
   ↓
STOPPING
   ↓
CLEANING
   ↓
EVALUATING
   ↓
COMPLETED
```

Possible terminal/error states:

```text
FAILED
ABORTED
TIMED_OUT
CLEANUP_FAILED
TARGET_LOST
```

The state machine is designed around the realities of browser execution and Manifest V3 service-worker suspension.

---

# Safety

HAVOC is intentionally bounded.

V1 experiments operate only on:

* the explicitly selected/current active tab
* the current target origin
* the top-level frame

HAVOC does not intentionally:

* modify unrelated tabs
* affect unrelated origins
* target child iframes
* submit forms automatically
* perform destructive application actions
* silently execute experiments

Every mutation introduced by HAVOC must have a cleanup path.

---

# Resource Registry

Experiments may temporarily create:

```text
fetch hooks
XHR hooks
timers
event listeners
observers
injected styles
```

These resources are tracked centrally.

```text
Experiment
     │
     ▼
Resource Registry
     ├── fetch hook
     ├── XHR hook
     ├── timer
     ├── observer
     └── event listener
```

When the experiment ends:

```text
STOP
 ↓
Cleanup all resources
 ↓
Verify cleanup
 ↓
Evaluate recovery
```

Cleanup is:

* best effort
* idempotent
* independently attempted
* observable
* capable of reporting partial failure

The goal is simple:

> **HAVOC should never leave the application in a modified state because its own cleanup logic gave up halfway through.**

---

# Evidence-First Analysis

HAVOC does not treat "something looked wrong" as a finding.

Findings must be backed by evidence.

```text
Events
  ↓
Signals
  ↓
Evidence
  ↓
Finding
```

Evidence may reference:

```text
Event
Signal
Metric
Snapshot
```

Causal relationships are preserved through:

```text
correlationId
parentEventId
sequence
timestamp
```

This allows HAVOC to construct a trace such as:

```text
User Interaction
       │
       ▼
Request Started
       │
       ▼
Chaos Injected
       │
       ▼
Request Failed
       │
       ▼
Error State Detected
       │
       ▼
Recovery Completed
```

---

# Recovery

Failure alone is not a bug.

A resilient application can fail safely and recover correctly.

HAVOC therefore evaluates application recovery separately from experiment cleanup.

Recovery outcomes:

```text
RECOVERED
DEGRADED
FAILED
UNKNOWN
```

`UNKNOWN` is intentional.

If HAVOC cannot establish whether recovery occurred, it should say:

```text
UNKNOWN
```

rather than inventing confidence.

Recovery evaluation happens over an explicit observation/recovery window rather than immediately after the injected failure.

---

# V1 Experiments

HAVOC V1 intentionally starts small.

### 1. Fetch Latency

Inject controlled latency into network requests.

Initial experiment:

```text
3-second Fetch Latency
```

### 2. Fetch Failure

Controlled failure modes:

```text
transport_error
synthetic_http_error
synthetic_timeout
```

These remain semantically distinct.

For example:

```text
Transport Error
→ fetch rejects

HTTP 500
→ fetch resolves
→ response.ok === false

Timeout
→ behavior depends on application timeout handling
```

### Future experiments

```text
Input Stress
Viewport / Layout Stress
```

Input stress begins passively.

HAVOC does not automatically submit forms or trigger potentially destructive actions.

---

# Development Roadmap

HAVOC is being built in deliberate phases.

```text
0. FOUNDATION
      ↓
1. MV3 RUNTIME
      ↓
2. INSTRUMENTATION
      ↓
3. ENGINE
      ↓
4. CHAOS
      ↓
5. SIGNALS
      ↓
6. AUTOPSY
      ↓
7. PERSISTENCE
      ↓
8. PIXEL UI
      ↓
9. HARDENING
      ↓
10. HAVOC v1.0
```

After V1:

```text
Playwright Runtime
      ↓
CLI
      ↓
CI
      ↓
Observability
      ↓
AI
```

These are intentionally outside the V1 implementation boundary.

---

# V1 Vertical Slice

The first real end-to-end slice is:

```text
Chrome
  ↓
Page Instrumentation
  ↓
Fetch Observation
  ↓
3s Latency Injection
  ↓
Event Stream
  ↓
Signal
  ↓
Finding
  ↓
Recovery
  ↓
Autopsy
```

The first milestone is deliberately not a beautiful dashboard.

It is proving that HAVOC can reliably perform this loop:

```text
Inject
  ↓
Observe
  ↓
Analyze
  ↓
Cleanup
  ↓
Explain
```

---

# Testing Philosophy

HAVOC uses deterministic golden tests to protect its core reasoning.

Important scenarios include:

### Recovery

```text
Failure
 ↓
Retry
 ↓
Success
 ↓
Stable UI

Expected:
RECOVERED
```

### Unknown

```text
Failure
 ↓
Ambiguous application behavior
 ↓
Recovery cannot be established

Expected:
UNKNOWN
```

### No unjustified finding

HAVOC must not produce a high-severity finding when the evidence does not support one.

### Cleanup

```text
Resource A → ✓
Resource B → ✓
Resource C → ✓

Expected:
clean
```

And:

```text
Resource A → ✓
Resource B → ✗
Resource C → ✓

Expected:
CLEANUP_FAILED
```

---

# Project Structure

The repository is intentionally organized around runtime boundaries and domain responsibilities.

```text
extension/
├── public/
│   └── manifest.json
│
└── src/
    ├── background/
    │   └── service-worker.ts
    │
    ├── content/
    │   └── content-script.ts
    │
    ├── page/
    │   └── ...
    │
    ├── domain/
    │   ├── target.ts
    │   ├── event.ts
    │   ├── signal.ts
    │   ├── finding.ts
    │   ├── evidence.ts
    │   ├── recovery.ts
    │   ├── experiment.ts
    │   └── run.ts
    │
    ├── engine/
    │   ├── ...
    │
    ├── messaging/
    │   ├── messages.ts
    │   └── validator.ts
    │
    ├── runtime/
    │   └── ...
    │
    ├── storage/
    │   └── database.ts
    │
    └── popup/
        ├── App.svelte
        └── main.ts
```

The structure may evolve as implementation reveals better boundaries, but the architectural contracts remain stable.

---

# Technology

V1:

| Layer       | Technology                         |
| ----------- | ---------------------------------- |
| Extension   | Chrome Manifest V3                 |
| Language    | TypeScript                         |
| UI          | Svelte                             |
| Build       | Vite                               |
| Persistence | IndexedDB                          |
| Runtime     | Chrome                             |
| Testing     | TypeScript-compatible test tooling |

The project intentionally avoids premature infrastructure.

Not in V1:

```text
Go
PostgreSQL
Redis
WebSockets
Kubernetes
Playwright
CLI
CI infrastructure
OpenTelemetry
Prometheus
Grafana
AI
```

These become relevant only after the browser-native core has been proven.

---

# Design Principles

HAVOC is built around a few non-negotiable principles.

### 1. Controlled failure

Chaos must be bounded, deterministic, and reversible.

### 2. Evidence over intuition

Every finding must be explainable from observable evidence.

### 3. Event ≠ Signal ≠ Finding

Raw observations must remain distinguishable from interpretation.

### 4. Uncertainty is valid

HAVOC may report `UNKNOWN`.

It must never manufacture certainty.

### 5. Cleanup is mandatory

Every mutation must have an owner and cleanup path.

### 6. The popup is not the runtime

UI lifecycle must never control experiment lifecycle.

### 7. Runtime-specific implementation, shared domain contracts

Chrome and future Playwright runtimes share concepts, not necessarily implementation details.

### 8. Build the smallest vertical slice first

HAVOC earns complexity only after the core loop works.

---

# Current Status

🚧 **Early Development**

Current repository state:

```text
Phase -1
Empty scaffold
```

The next milestone is:

```text
Phase 0 — Foundation
```

The immediate objective is to produce a buildable, loadable Chrome MV3 extension with the foundational domain and runtime contracts in place.

---

# The Long-Term Vision

HAVOC starts inside the browser.

Eventually, the same experimental model can operate across:

```text
Browser Extension
      ↓
Playwright Runtime
      ↓
CLI
      ↓
CI
      ↓
Observability
      ↓
AI-assisted Autopsy
```

The long-term goal is not simply to generate more failures.

It is to build a system capable of answering:

> **What happened when the system failed, why did it happen, did the application recover, and what evidence proves it?**

That's HAVOC.

---

## License

License information will be added before the first public release.
