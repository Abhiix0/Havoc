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

  it('serves index.html on root path with 200 OK and substitutes template placeholder', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('HAVOC Microservice Dashboard'));
    assert.strictEqual(text.includes('%%APP_CONFIG_JSON%%'), false, 'Placeholder must be substituted');
    assert.ok(text.includes('STRIPE_TEST_SECRET')); // Flaw E fake credential present in default broken mode
    assert.ok(text.includes('sk_test_FAKEDEMOFAKEDEMOFAKEDEMO1234'));
  });

  it('serves index.html with ?mode=fixed without any fake credentials (Flaw E resolved)', async () => {
    const res = await fetch(`${baseUrl}/?mode=fixed`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('HAVOC Microservice Dashboard'));
    assert.strictEqual(text.includes('%%APP_CONFIG_JSON%%'), false, 'Placeholder must be substituted in fixed mode');
    assert.ok(text.includes('pub_client_safe_demo_9876'));
    // Crucial: Zero occurrences of fake credential markers anywhere in the fixed variant response body
    assert.strictEqual(text.includes('FAKEDEMOFAKEDEMO'), false, 'Fixed mode must not contain FAKEDEMOFAKEDEMO');
    assert.strictEqual(text.includes('AKIAFAKEFAKEFAKE'), false, 'Fixed mode must not contain AKIAFAKEFAKEFAKE');
    assert.strictEqual(text.includes('STRIPE_TEST_SECRET'), false, 'Fixed mode must not contain STRIPE_TEST_SECRET');
  });

  it('serves index.html with ?mode=broken with fake credentials present (Flaw E active)', async () => {
    const res = await fetch(`${baseUrl}/?mode=broken`);
    assert.strictEqual(res.status, 200);
    const text = await res.text();
    assert.strictEqual(text.includes('%%APP_CONFIG_JSON%%'), false, 'Placeholder must be substituted in broken mode');
    assert.ok(text.includes('sk_test_FAKEDEMOFAKEDEMOFAKEDEMO1234'));
    assert.ok(text.includes('AKIAFAKEFAKEFAKE1234'));
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
