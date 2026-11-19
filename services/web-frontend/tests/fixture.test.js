import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import { startUiFixture } from './ui-fixture.mjs';

test('legacy fixture configuration still injects a Vite client despite disabling its websocket server', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
  });
  try {
    const html = await vite.transformIndexHtml(
      '/',
      '<html><head></head><body></body></html>',
    );
    assert.ok(html.includes('/@vite/client'));
  } finally {
    await vite.close();
  }
});

test('static test fixture serves compiled React and CSS without Vite/HMR client', async () => {
  const fixture = await startUiFixture();
  try {
    const html = await (await fetch(fixture.url)).text();
    assert.ok(html.includes('test-sign-in'));
    assert.ok(!html.includes('/@vite/client'));
    const script = html.match(/<script type="module" src="([^"]+)"/)[1];
    const response = await fetch(fixture.url + script);
    assert.equal(response.status, 200);
    const code = await response.text();
    assert.ok(!code.includes('/@react-refresh'));
    assert.ok(!code.includes('/@vite/client'));
    assert.ok(!code.includes('failed to connect to websocket'));
    const css = html.match(/<link rel="stylesheet" href="([^"]+)"/)[1];
    assert.equal((await fetch(fixture.url + css)).status, 200);
    assert.equal((await fetch(fixture.url + '/@vite/client')).status, 404);
  } finally {
    await fixture.close();
  }
});

test('normal dev HTML deliberately includes the development HMR client', async () => {
  const vite = await createServer({
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  });
  try {
    await vite.listen();
    const url = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const html = await (await fetch(url)).text();
    assert.ok(html.includes('/@vite/client'));
    assert.ok(html.includes('/src/main.jsx'));
    assert.equal((await fetch(url + '/@vite/client')).status, 200);
  } finally {
    await vite.close();
  }
});
