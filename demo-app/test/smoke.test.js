import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createServer } from '../server.js';

describe('HAVOC Demo App Server Smoke Tests', () => {
  let serverInstance;
  let baseUrl;

  before(async () => {
    const { server } = createServer('broken');
    serverInstance = server;
    await new Promise((resolve) => {
      serverInstance.listen(0, () => {
        const port = serverInstance.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => serverInstance.close(resolve));
  });

  it('serves index.html on root path with 200 OK', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('HAVOC Microservice Dashboard'));
    assert.ok(text.includes('STRIPE_TEST_SECRET')); // Flaw E fake credential present in broken mode
  });

  it('serves static assets (css, js)', async () => {
    const cssRes = await fetch(`${baseUrl}/style.css`);
    assert.strictEqual(cssRes.status, 200);
    assert.ok(cssRes.headers.get('content-type')?.includes('text/css'));

    const jsRes = await fetch(`${baseUrl}/app.js`);
    assert.strictEqual(jsRes.status, 200);
    assert.ok(jsRes.headers.get('content-type')?.includes('javascript'));
  });

  it('GET /api/items returns items array on normal request', async () => {
    const res = await fetch(`${baseUrl}/api/items`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.items));
    assert.strictEqual(data.items.length, 4);
  });

  it('GET /api/items?fail=true returns HTTP 500 in broken mode (Flaw A)', async () => {
    const res = await fetch(`${baseUrl}/api/items?fail=true`);
    assert.strictEqual(res.status, 500);
    const data = await res.json();
    assert.ok(data.error.includes('timeout'));
  });

  it('GET /api/slow-endpoint takes > 2000ms to respond (Flaw B)', async () => {
    const start = Date.now();
    const res = await fetch(`${baseUrl}/api/slow-endpoint`);
    const elapsed = Date.now() - start;

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.activeServices > 0);
    assert.ok(elapsed >= 2000, `Expected delay >= 2000ms, took ${elapsed}ms`);
  });

  it('GET /api/mode reflects the active mode', async () => {
    const res = await fetch(`${baseUrl}/api/mode`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.mode, 'broken');

    const fixedRes = await fetch(`${baseUrl}/api/mode?mode=fixed`);
    assert.strictEqual(fixedRes.status, 200);
    const fixedData = await fixedRes.json();
    assert.strictEqual(fixedData.mode, 'fixed');
  });
});
