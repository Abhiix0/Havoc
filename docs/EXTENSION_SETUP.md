# HAVOC Extension Setup & Developer Guide

This document describes how to build, verify, load, and develop the HAVOC Chrome Manifest V3 extension.

---

## Quickstart: Build & Load

### Prerequisites
- Node.js 18+ (tested on Node 20 / 22 / 24)
- npm 9+
- Google Chrome or a Chromium-based browser (Brave, Edge)

### 1. Install Dependencies
```bash
cd extension
npm install
```

### 2. Build the Extension Bundle
```bash
npm run build
```
*(Or from the repository root: `npm run build:extension`)*

The build pipeline:
1. Runs Vite with `@crxjs/vite-plugin` and `@sveltejs/vite-plugin-svelte` to compile popup UI, service worker, and assets.
2. Executes custom `esbuild` passes to compile `content-script.ts` and `bridge.ts` into isolated, importless IIFEs.
3. Automatically executes `node scripts/verify-build.mjs` to validate build integrity before exiting.

### 3. Load Unpacked in Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Toggle **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select the directory:
   ```
   <repo-root>/extension/dist
   ```
5. Pin the **HAVOC** icon in your browser toolbar.

---

## The Standalone Script Constraint (IIFE vs ESM)

A crucial architectural requirement in HAVOC is that injected browser scripts must be **completely self-contained classic IIFEs with zero `import` or `export` statements**.

### 1. `dist/src/content/content-script.js`
- **Constraint**: HAVOC does not use declarative `content_scripts` in `manifest.json`. Instead, it injects the content script on-demand via `chrome.scripting.executeScript`.
- **Reason**: In Chrome Manifest V3, file-based `executeScript` runs as a classic (non-module) script. If Rollup code-splits `content-script.ts` into ES module chunks, Chrome crashes immediately with:
  ```
  Uncaught SyntaxError: Cannot use import statement outside a module
  ```
- **Solution**: A dedicated `esbuild` pass bundles `content-script.ts` with `format: 'iife'`, inlining all helper functions and validator modules into a single classic script.

### 2. `dist/src/page/bridge.js`
- **Constraint**: The bridge runs in the main page world (injected by the content script to intercept `window.fetch`, `XMLHttpRequest`, and runtime errors).
- **Reason**: Chrome enforces that any script resource loaded from a chrome-extension:// URL in the page world must be explicitly declared in `manifest.json`'s `web_accessible_resources`. If Rollup splits shared libraries (e.g. `validator.ts`, `sanitize-url.ts`) into content-hashed chunks (`assets/validator-[hash].js`), Chrome blocks those chunk requests with:
  ```
  Denying load of chrome-extension://.../assets/validator-...js. Resources must be listed in the web_accessible_resources manifest key.
  ```
  Because hashed filenames change on every build, listing individual chunk files in `manifest.json` is fragile.
- **Solution**: `src/page/bridge.ts` is bundled with `esbuild` as a standalone IIFE directly into `dist/src/page/bridge.js`, with zero external imports. In addition, removing `src/page/bridge` from Rollup's `rollupOptions.input` prevents Rollup from generating orphaned or split chunks.

---

## Build Verification (`verify-build.mjs`)

To ensure no future dependency additions silently reintroduce chunk splitting or module syntax errors, `extension/scripts/verify-build.mjs` runs automatically on every `npm run build`:

```bash
npm run verify-build
```

### What It Asserts:
1. **Content Script**: `dist/src/content/content-script.js` exists and contains **zero** `import` and **zero** `export` statements.
2. **Page Bridge**: `dist/src/page/bridge.js` exists and contains **zero** `import` and **zero** `export` statements.
3. **Manifest Injection Policy**: `dist/manifest.json` contains no declarative `content_scripts` array (enforcing dynamic, on-demand injection).
4. **Web Accessible Resources**: `dist/manifest.json` lists `src/page/bridge.js` and contains **no** uncompiled `.ts` files.

If any assertion fails, the script exits with code `1`, halting CI and build scripts.

---

## Running Unit & Smoke Tests

Run the Vitest test suite (includes domain models, engines, stores, and build verification tests):

```bash
cd extension
npm test
```
*(Or from root: `npm run test:extension`)*

```bash
# Watch mode during development
npx vitest
```
