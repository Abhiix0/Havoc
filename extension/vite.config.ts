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
 * CRXJS beta-31 emits web-accessible page-world scripts with their source
 * extension (.ts) rather than renaming them to .js. Chrome refuses to execute
 * files served with an unrecognised extension, so we rename them and patch
 * the dist manifest in a closeBundle hook that runs after CRXJS writes its
 * output.
 *
 * Source entry: src/page/bridge.ts
 * CRXJS output: dist/src/page/bridge.ts   ← blocked by Chrome
 * After patch:  dist/src/page/bridge.js   ← works
 */
function fixPageScriptExtensions(): Plugin {
  return {
    name: 'havoc-fix-page-script-extensions',
    apply: 'build',
    closeBundle() {
      const outDir = path.resolve(__dirname, 'dist');
      const manifestPath = path.join(outDir, 'manifest.json');

      if (!fs.existsSync(manifestPath)) return;

      const raw = fs.readFileSync(manifestPath, 'utf-8');
      let patched = raw;

      // Rename every .ts file under src/page/ in the dist tree.
      const pageSrcDir = path.join(outDir, 'src', 'page');
      if (fs.existsSync(pageSrcDir)) {
        for (const file of fs.readdirSync(pageSrcDir)) {
          if (!file.endsWith('.ts')) continue;
          const oldPath = path.join(pageSrcDir, file);
          const newFile = file.replace(/\.ts$/, '.js');
          const newPath = path.join(pageSrcDir, newFile);
          fs.renameSync(oldPath, newPath);
          // Also patch the manifest string so the resource path matches.
          patched = patched.split(`src/page/${file}`).join(`src/page/${newFile}`);
        }
      }

      fs.writeFileSync(manifestPath, patched, 'utf-8');
    },
  };
}

export default defineConfig({
  plugins: [
    svelte({ preprocess: sveltePreprocess() }),
    crx({ manifest }),
    fixPageScriptExtensions(),
  ],
});
