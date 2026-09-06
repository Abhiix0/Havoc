import { defineConfig, type Plugin } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import sveltePreprocess from 'svelte-preprocess';
import manifest from './public/manifest.json' with { type: 'json' };
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bundles standalone injected scripts (content-script.ts and bridge.ts) into
 * self-contained IIFE scripts with zero external imports/exports.
 *
 * 1. content-script.ts is dynamically injected via chrome.scripting.executeScript,
 *    which runs as a classic (non-module) script in Chrome MV3.
 * 2. bridge.ts is injected into the page world. Because it runs in an untrusted page
 *    context, having external chunk imports (e.g. assets/validator-*.js) fails
 *    because Chrome restricts web_accessible_resources to exactly listed paths.
 *    By bundling it with esbuild as a standalone IIFE, all dependencies (validator,
 *    sanitize-url, messages, instrumentation, runtime-error-capture) are inlined.
 *
 * In addition:
 * - Public manifest declares 'src/page/bridge.ts' so CRXJS source validation passes.
 * - In closeBundle, we remove any raw 'dist/src/page/bridge.ts' asset that CRXJS emitted,
 *   emit the compiled 'dist/src/page/bridge.js', and patch dist/manifest.json.
 */
function bundleStandaloneScripts(): Plugin {
  return {
    name: 'havoc-bundle-standalone-scripts',
    apply: 'build',
    async closeBundle() {
      // 1. Bundle content-script.ts as standalone IIFE
      const csEntry = path.resolve(__dirname, 'src/content/content-script.ts');
      const csOutfile = path.resolve(__dirname, 'dist/src/content/content-script.js');
      await esbuild.build({
        entryPoints: [csEntry],
        bundle: true,
        format: 'iife',
        target: 'es2022',
        outfile: csOutfile,
        sourcemap: false,
      });
      console.log('[havoc] dist/src/content/content-script.js: built standalone IIFE classic script');

      // 2. Bundle bridge.ts as standalone IIFE
      const bridgeEntry = path.resolve(__dirname, 'src/page/bridge.ts');
      const bridgeOutfile = path.resolve(__dirname, 'dist/src/page/bridge.js');
      await esbuild.build({
        entryPoints: [bridgeEntry],
        bundle: true,
        format: 'iife',
        target: 'es2022',
        outfile: bridgeOutfile,
        sourcemap: false,
      });
      console.log('[havoc] dist/src/page/bridge.js: built standalone IIFE script');

      // 3. Remove raw bridge.ts if CRXJS copied it
      const rawBridgeTs = path.resolve(__dirname, 'dist/src/page/bridge.ts');
      if (fs.existsSync(rawBridgeTs)) {
        fs.unlinkSync(rawBridgeTs);
      }

      // 4. Rewrite dist/manifest.json: bridge.ts → bridge.js
      const manifestPath = path.resolve(__dirname, 'dist', 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const raw = fs.readFileSync(manifestPath, 'utf-8');
        const patched = raw.split('src/page/bridge.ts').join('src/page/bridge.js');
        if (patched !== raw) {
          fs.writeFileSync(manifestPath, patched, 'utf-8');
          console.log('[havoc] dist/manifest.json: bridge.ts → bridge.js');
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    svelte({ preprocess: sveltePreprocess() }),
    bundleStandaloneScripts(),
    crx({ manifest }),
  ],
});
