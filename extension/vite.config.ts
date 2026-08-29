import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import sveltePreprocess from 'svelte-preprocess';
import manifest from './public/manifest.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    svelte({ preprocess: sveltePreprocess() }),
    crx({ manifest }),
  ],
});