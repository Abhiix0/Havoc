# HAVOC Target Demo Application

> [!IMPORTANT]
> **Required Usage**:
> The demo application **must be served via `npm start`** (`node server.js`). Do **not** open `index.html` directly as a `file://` URL in the browser. The server dynamically performs configuration/credential injection and hosts the mock API endpoints required for the Ship Checks.
>
> ```bash
> cd demo-app
> npm start
> ```
> Then open **[http://localhost:3000](http://localhost:3000)** in your browser.

A lightweight, self-contained demonstration web application built specifically to audit, test, and demonstrate **HAVOC's Six Ship Checks**.

The application models a realistic microservice monitoring dashboard with **six isolated, deliberate flaws** (one per Ship Check) in `broken` mode, alongside a clean, robust `fixed` variant.

---

## Quick Start

### 1. Run the Demo Server (Default / Broken Mode)
```bash
cd demo-app
npm start
# or: npm run demo:broken
```
Open **[http://localhost:3000](http://localhost:3000)** (or `http://localhost:3000/?mode=broken`).

### 2. Run in Fixed Mode (Flaws Resolved)
```bash
cd demo-app
npm run demo:fixed
```
Open **[http://localhost:3000/?mode=fixed](http://localhost:3000/?mode=fixed)**.

### 3. Run Automated Smoke Tests
```bash
cd demo-app
npm test
```

---

## Flaw-to-Check Mapping Matrix

| # | HAVOC Ship Check | Planted Flaw (`broken` mode) | Resolution (`fixed` mode) |
|---|---|---|---|
| **1** | `fetch_failure` | `/api/items?fail=true` returns 500; frontend has no error handling (`.catch()`), leaving the loading spinner active forever without displaying an error message. | Adds comprehensive error handling, clears the spinner, and renders an actionable error alert with a retry button. |
| **2** | `fetch_latency` | `/api/slow-endpoint` has an artificial 2.5s delay; clicking "Fetch Summary" shows no loading indicator or spinner, making the UI appear frozen. | Displays an immediate loading spinner and disables the button during network latency. |
| **3** | `input_stress` | Form input parses tag codes with unchecked array indexing (`rawValue.split('-')[1].trim()`), throwing a `TypeError` on non-hyphenated or long strings. | Bounds-checks string length (`slice(0, 100)`) and safely falls back when separators are absent. |
| **4** | `runtime_errors` | Clicking "Inspect User Profile" accesses `window.sessionContext.user.preferences.theme` when `user` is `null` (anonymous session), triggering an uncaught `TypeError`. | Uses optional chaining (`window.sessionContext?.user?.preferences?.theme`) with a default fallback. |
| **5** | `secret_scan` | Exposes a clearly labeled fake test secret key (`sk_test_FAKEDEMOFAKEDEMO...`) in the client-side bundle. | Removes sensitive secret patterns from the client bundle. |
| **6** | `viewport_stress` | Cluster nodes table container uses a fixed `width: 1050px`, causing horizontal layout overflow on mobile / narrow viewports (< 1050px). | Uses responsive styles (`max-width: 100%; overflow-x: auto;`) allowing responsive table scrolling. |

---

## Mode Switching

You can switch between `broken` and `fixed` modes in three ways:

1. **In the Browser URL**:
   - `http://localhost:3000/?mode=broken`
   - `http://localhost:3000/?mode=fixed`
   - Or click the toggle link in the top banner.

2. **Via NPM Scripts**:
   ```bash
   npm run demo:broken  # runs with --mode=broken
   npm run demo:fixed   # runs with --mode=fixed
   ```

3. **Via Environment Variable**:
   ```bash
   HAVOC_DEMO_MODE=fixed node server.js
   ```

---

## Auditing with HAVOC Extension

1. Start the demo app in broken mode:
   ```bash
   npm run demo:broken
   ```
2. Navigate to `http://localhost:3000` in Google Chrome with the HAVOC extension loaded.
3. Open the HAVOC extension popup and click **"Run Ship Check"**.
4. Observe that HAVOC produces findings across the checks and rates the application readiness accordingly (`NEEDS_ATTENTION` or `BLOCKED`).
5. Switch to Fixed mode (`http://localhost:3000/?mode=fixed`) and re-run the Ship Check to observe that the issues are resolved and readiness turns `READY`.
