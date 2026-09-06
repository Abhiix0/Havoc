# HAVOC Demo Application Guide

The `demo-app/` package is a self-contained target application built with vanilla Node.js HTTP and frontend JavaScript. It provides a realistic testbed for verifying HAVOC's Ship Check suite in both **broken** (vulnerable) and **fixed** (resilient) modes.

---

## Running the Demo App

### 1. Install & Start
The demo app has zero external npm dependencies (pure Node.js standard library):

```bash
cd demo-app
npm start
```
*(Or from the repository root: `npm run demo`)*

By default, the server listens at **`http://localhost:3000`** in **broken** mode.

### 2. Launching in Specific Modes

```bash
# Start directly in Broken mode:
npm run demo:broken --prefix demo-app
# (or from root: npm run demo:broken)

# Start directly in Fixed mode:
npm run demo:fixed --prefix demo-app
# (or from root: npm run demo:fixed)
```

You can also dynamically switch modes at runtime by navigating to:
- **Broken**: `http://localhost:3000/?mode=broken`
- **Fixed**: `http://localhost:3000/?mode=fixed`

---

## The Six Planted Flaws

The demo app includes exactly six deliberate resilience flaws corresponding to the six HAVOC Ship Checks:

| Flaw | Check Kind | File & Location | Description |
| :--- | :--- | :--- | :--- |
| **Flaw A** | `fetch_failure` | [`demo-app/public/app.js`](file:///d:/Abhiix0/Flagship%20Projects/Havoc/Havoc/demo-app/public/app.js#L54-L98)<br/>[`demo-app/server.js`](file:///d:/Abhiix0/Flagship%20Projects/Havoc/Havoc/demo-app/server.js#L81-L92) | **API Failure / Unhandled Network Drop**: `loadItems()` fetches `/api/items?fail=true`. In broken mode, the promise has no `.catch()` handler and does not clear `itemsLoading.style.display`, leaving the UI permanently frozen with a loading spinner on HTTP 500 or transport drops. In fixed mode, errors are caught, spinners are cleared in `.finally()`, and an error banner with a retry button is shown. |
| **Flaw B** | `fetch_latency` | [`demo-app/public/app.js`](file:///d:/Abhiix0/Flagship%20Projects/Havoc/Havoc/demo-app/public/app.js#L110-L148)<br/>[`demo-app/server.js`](file:///d:/Abhiix0/Flagship%20Projects/Havoc/Havoc/demo-app/server.js#L94-L108) | **API Latency / Missing Loading Feedback**: The server simulates a 2.5s slow aggregation endpoint at `/api/slow-endpoint`. In broken mode, clicking "Fetch Summary" does not show a loading indicator or disable the button, giving no feedback to the user. In fixed mode, an immediate loading spinner is rendered and the button is disabled during the request. |
| **Flaw C** | `input_stress` | [`demo-app/public/app.js`](file:///d:/Abhiix0/Flagship%20Projects/Havoc/Havoc/demo-app/public/app.js#L150-L183) | **Form / Input Fuzzing Crash**: The tag registration form naively calls `rawValue.split('-')` and accesses index `1` (`parts[1].trim()`) without validating array length. Fuzzing with boundary characters, missing hyphens, or whitespace throws an unhandled `TypeError: Cannot read properties of undefined (reading 'trim')`. In fixed mode, inputs are sliced and defaulted safely. |
| **Flaw D** | `runtime_errors` | [`demo-app/public/app.js`](file:///d:/Abhiix0/Flagship%20Projects/Havoc/Havoc/demo-app/public/app.js#L185-L208) | **Uncaught Null Property Dereference**: Clicking "Inspect Session Profile" accesses `window.sessionContext.user.preferences.theme` when `window.sessionContext.user` is `null` (simulating an unauthenticated state), triggering an uncaught exception. In fixed mode, optional chaining (`user?.preferences?.theme`) with fallback values is used. |
| **Flaw E** | `secret_scan` | [`demo-app/server.js`](file:///d:/Abhiix0/Flagship%20Projects/Havoc/Havoc/demo-app/server.js#L34-L50) | **Client-Side Secret Exposure**: In broken mode, `server.js` renders `%%APP_CONFIG_JSON%%` containing fake test credentials (`sk_test_FAKEDEMO...` and `AKIAFAKE...`) directly into a `<script>` tag in `index.html`. In fixed mode, only non-sensitive public configuration (`PUBLIC_CLIENT_ID`) is shared with the client. |
| **Flaw F** | `viewport_stress` | [`demo-app/public/index.html`](file:///d:/Abhiix0/Flagship%20Projects/Havoc/Havoc/demo-app/public/index.html#L113-L163)<br/>[`demo-app/public/style.css`](file:///d:/Abhiix0/Flagship%20Projects/Havoc/Havoc/demo-app/public/style.css#L164-L177) | **Responsive Layout / Horizontal Overflow**: The infrastructure cluster nodes table has an unconstrained wrapper (`broken-fixed-table-wrapper`) with fixed-width columns exceeding 900px without `overflow-x: auto`. When HAVOC applies narrow viewport constraints, `document.documentElement.scrollWidth > clientWidth + 4` triggers layout overflow detection. In fixed mode, `overflow-x: auto` is applied. |

---

## Testing Both Modes with HAVOC

1. Run the demo app (`npm start` in `demo-app`).
2. Open `http://localhost:3000/?mode=broken` in Chrome.
3. Open the HAVOC popup and run a **Ship Check**.
   - **Expected Readiness**: `NEEDS_ATTENTION` or `BLOCKED`
   - Real findings will appear across all six check phases with captured technical evidence.
4. Switch to `http://localhost:3000/?mode=fixed`.
5. Rerun the **Ship Check**.
   - **Expected Readiness**: `READY`
   - All 6 steps pass cleanly with 0 findings.
