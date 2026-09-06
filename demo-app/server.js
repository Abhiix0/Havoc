import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mode: broken by default, can be toggled via CLI flag --mode=fixed or env HAVOC_DEMO_MODE=fixed
const args = process.argv.slice(2);
const cliModeArg = args.find((a) => a.startsWith('--mode='));
const defaultMode = cliModeArg
  ? cliModeArg.split('=')[1]
  : process.env.HAVOC_DEMO_MODE || 'broken';

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

const SAMPLE_ITEMS = [
  { id: 'item-1', code: 'SRV-PAYMENT', title: 'Payment Gateway Client', status: 'ACTIVE' },
  { id: 'item-2', code: 'SRV-AUTH', title: 'Authentication Service', status: 'ACTIVE' },
  { id: 'item-3', code: 'SRV-CHECKOUT', title: 'Checkout Flow Controller', status: 'MAINTENANCE' },
  { id: 'item-4', code: 'SRV-INVENTORY', title: 'Inventory Sync Worker', status: 'ACTIVE' },
];

// =========================================================================
// FLAW E (SECRET_SCAN Check Target):
// FAKE CREDENTIAL FOR HAVOC DEMO PURPOSES ONLY — DOES NOT WORK,
// DO NOT REPORT AS A REAL LEAK.
// In broken mode, this fake test key is exposed in the client script bundle.
// In fixed mode, sensitive configuration is kept server-side.
// =========================================================================
const BROKEN_APP_CONFIG = {
  ENV: 'demo-broken',
  STRIPE_TEST_SECRET: 'sk_test_FAKEDEMOFAKEDEMOFAKEDEMO1234',
  AWS_BACKUP_ACCESS_KEY: 'AKIAFAKEFAKEFAKE1234',
};

const FIXED_APP_CONFIG = {
  ENV: 'demo-fixed',
  PUBLIC_CLIENT_ID: 'pub_client_safe_demo_9876',
};

export function createServer(initialMode = defaultMode) {
  let currentMode = initialMode;

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
    const pathname = parsedUrl.pathname;
    const searchParams = parsedUrl.searchParams;

    // Allow query parameter override per request (?mode=broken or ?mode=fixed)
    const requestMode = searchParams.get('mode') || currentMode;

    // CORS headers for flexibility
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. API: /api/mode
    if (pathname === '/api/mode') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ mode: requestMode }));
      return;
    }

    // 2. API: /api/items (Flaw A: API Failure)
    if (pathname === '/api/items') {
      const shouldFail = searchParams.get('fail') === 'true' || searchParams.has('fail');
      if (requestMode === 'broken' && shouldFail) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal database connection pool timeout' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: SAMPLE_ITEMS }));
      return;
    }

    // 3. API: /api/slow-endpoint (Flaw B: API Latency)
    if (pathname === '/api/slow-endpoint' || pathname === '/api/summary') {
      // Simulate slow backend computation / delayed response (2.5s)
      await new Promise((resolve) => setTimeout(resolve, 2500));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          activeServices: 4,
          avgLatencyMs: 42,
          reliabilityScore: 0.999,
          lastCheck: new Date().toISOString(),
        })
      );
      return;
    }

    // 4. Static Assets & Dynamic index.html template substitution
    const isIndexHtml = pathname === '/' || pathname === '/index.html';
    let filePath = path.join(PUBLIC_DIR, isIndexHtml ? 'index.html' : pathname);

    // Normalize path to prevent directory traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, isIndexHtml ? 'utf8' : null, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        } else {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error');
        }
        return;
      }

      if (isIndexHtml && typeof content === 'string') {
        const configToInject = requestMode === 'fixed' ? FIXED_APP_CONFIG : BROKEN_APP_CONFIG;
        const renderedHtml = content.replace('%%APP_CONFIG_JSON%%', JSON.stringify(configToInject));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderedHtml);
        return;
      }

      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });

  return { server, getMode: () => currentMode, setMode: (m) => (currentMode = m) };
}

// Start standalone if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createServer(defaultMode);
  server.listen(PORT, () => {
    console.log(`[HAVOC DEMO APP] listening on http://localhost:${PORT}`);
    console.log(`[HAVOC DEMO APP] active mode: ${defaultMode.toUpperCase()}`);
    console.log(`  - Broken demo: http://localhost:${PORT}/?mode=broken`);
    console.log(`  - Fixed demo:  http://localhost:${PORT}/?mode=fixed`);
  });
}
