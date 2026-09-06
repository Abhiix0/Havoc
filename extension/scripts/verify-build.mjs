#!/usr/bin/env node

/**
 * verify-build.mjs
 *
 * Post-build verification asserting that:
 * 1. dist/src/content/content-script.js exists.
 * 2. dist/src/content/content-script.js is a self-contained classic script with ZERO
 *    top-level import or export statements (which would crash dynamic executeScript injection).
 * 3. dist/manifest.json has NO declarative content_scripts array (enforcing on-demand injection).
 * 4. dist/manifest.json correctly lists src/page/bridge.js in web_accessible_resources (not .ts).
 * 5. dist/src/page/bridge.js exists.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');

let failures = 0;

function fail(msg) {
  console.error(`\x1b[31m[VERIFY BUILD FAILED]\x1b[0m ${msg}`);
  failures++;
}

function pass(msg) {
  console.log(`\x1b[32m[VERIFY BUILD PASSED]\x1b[0m ${msg}`);
}

function checkNoImportsExports(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing built file at ${filePath}`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  // Check for forbidden module statements: import / export
  // Note: must require whitespace or brackets/quotes after 'import' to avoid false
  // positives on substrings like '!important' in injected CSS.
  const hasImport =
    /\bimport\s+(\{|\*|[a-zA-Z_$])/m.test(content) ||
    /\bimport\s*["'(]/m.test(content) ||
    /^\s*import\b/m.test(content);

  const hasExport =
    /\bexport\s+(\{|\*|[a-zA-Z_$]|default\b)/m.test(content) ||
    /^\s*export\b/m.test(content);

  if (hasImport) {
    fail(`${label} contains an ES \`import\` statement! It must be standalone with zero external chunk imports.`);
  } else {
    pass(`${label} has no \`import\` statements.`);
  }

  if (hasExport) {
    fail(`${label} contains an ES \`export\` statement! It must be a self-contained script.`);
  } else {
    pass(`${label} has no \`export\` statements.`);
  }
}

// 1. Check content script existence and self-containment
const contentScriptPath = path.join(distDir, 'src', 'content', 'content-script.js');
checkNoImportsExports(contentScriptPath, 'dist/src/content/content-script.js');

// 2. Check manifest
const manifestPath = path.join(distDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  fail(`Missing dist/manifest.json at ${manifestPath}`);
} else {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    if (manifest.content_scripts && manifest.content_scripts.length > 0) {
      fail('dist/manifest.json contains a content_scripts array. HAVOC requires dynamic executeScript injection.');
    } else {
      pass('dist/manifest.json has no declarative content_scripts (dynamic injection preserved).');
    }

    const war = manifest.web_accessible_resources ?? [];
    const allResources = war.flatMap((entry) => entry.resources ?? []);
    if (allResources.some((r) => r.endsWith('.ts'))) {
      fail('dist/manifest.json contains uncompiled .ts files in web_accessible_resources.');
    } else if (!allResources.includes('src/page/bridge.js')) {
      fail('dist/manifest.json is missing src/page/bridge.js in web_accessible_resources.');
    } else {
      pass('dist/manifest.json web_accessible_resources contains src/page/bridge.js.');
    }
  } catch (err) {
    fail(`Failed to parse dist/manifest.json: ${err.message}`);
  }
}

// 3. Check bridge script existence and self-containment
const bridgeScriptPath = path.join(distDir, 'src', 'page', 'bridge.js');
checkNoImportsExports(bridgeScriptPath, 'dist/src/page/bridge.js');

if (failures > 0) {
  console.error(`\n\x1b[31mBuild verification finished with ${failures} error(s).\x1b[0m\n`);
  process.exit(1);
} else {
  console.log('\n\x1b[32mAll build verification checks passed successfully.\x1b[0m\n');
  process.exit(0);
}
