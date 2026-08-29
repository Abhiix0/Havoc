import { defineConfig, type Plugin } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import sveltePreprocess from 'svelte-preprocess';
import manifest from './public/manifest.json' with { type: 'json' };
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * CRXJS beta-31 copies web_accessible_resources entries as raw static assets
 * rather than bundling them through Rollup, leaving TypeScript syntax in the
 * output. This plugin works around it:
 *
 *  - Source manifest keeps 'src/page/bridge.ts' so CRXJS source validation
 *    passes (it resolves against the project root before Rollup runs).
 *  - Rollup input 'src/page/bridge' + entryFileNames pattern ensures the
 *    compiled output lands at exactly 'src/page/bridge.js' in dist.
 *  - generateBundle(pre) aliases bundle['src/page/bridge.ts'] to the compiled
 *    chunk so CRXJS's `typeof bundle[f] !== "undefined"` guard finds it and
 *    skips the raw filesystem copy.
 *  - closeBundle rewrites the dist manifest to replace the .ts path with .js.
 */
function fixBridgeScriptForCrxjs(): Plugin {
  return {
    name: 'havoc-fix-bridge-script',
    apply: 'build',
    generateBundle: {
      order: 'pre',
      handler(_options, bundle) {
        const jsKey = 'src/page/bridge.js';
        const tsKey = 'src/page/bridge.ts';

        const compiled = bundle[jsKey];
        if (!compiled) return;

        // Alias the .ts key so CRXJS finds a bundle entry and skips copying
        // the raw source file from disk.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (bundle as any)[tsKey] = compiled;
      },
    },
    closeBundle() {
      // Rewrite the dist manifest: bridge.ts → bridge.js
      const manifestPath = path.resolve(__dirname, 'dist', 'manifest.json');
      if (!fs.existsSync(manifestPath)) return;
      const raw = fs.readFileSync(manifestPath, 'utf-8');
      const patched = raw.split('src/page/bridge.ts').join('src/page/bridge.js');
      if (patched !== raw) {
        fs.writeFileSync(manifestPath, patched, 'utf-8');
        console.log('[havoc] dist/manifest.json: bridge.ts → bridge.js');
      }
    },
  };
}

export default defineConfig({
  plugins: [
    svelte({ preprocess: sveltePreprocess() }),
    fixBridgeScriptForCrxjs(), // must be before crx() so generateBundle(pre) runs first
    crx({ manifest }),
  ],
  build: {
    rollupOptions: {
      input: {
        'src/page/bridge': 'src/page/bridge.ts',
      },
      // preserveEntrySignatures lives on RollupOptions, not on output
      preserveEntrySignatures: 'strict',
      output: {
        // Ensure the bridge entry chunk lands at src/page/bridge.js (no hash,
        // no assets/ prefix) so it matches the web_accessible_resources path
        // and the chrome.runtime.getURL call in the content script.
        entryFileNames: (chunk) => {
          if (chunk.name === 'src/page/bridge') return 'src/page/bridge.js';
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
});
