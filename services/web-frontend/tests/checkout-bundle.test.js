import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'vite';

test('product bundle contains intentional Mock adapter but excludes test server, session injection and auth bypass', async () => {
  const result = await build({ logLevel: 'error', build: { write: false } });
  const chunks = result.output.filter((file) => file.type === 'chunk');
  const ids = chunks.flatMap((file) => Object.keys(file.modules));
  const code = chunks.map((file) => file.code).join('\n');
  assert.ok(
    ids.some((id) =>
      id.replaceAll('\\', '/').endsWith('/src/checkout/mockCheckoutAdapter.js'),
    ),
  );
  assert.ok(
    !ids.some((id) =>
      /\/tests\/|playwright|node:http/.test(id.replaceAll('\\', '/')),
    ),
  );
  for (const forbidden of [
    '__checkoutQA',
    'test-sign-in',
    'checkout-browser-entry',
    'X-User-Id',
    'node:http',
    'playwright',
  ])
    assert.ok(!code.includes(forbidden), forbidden);
  assert.ok(code.includes('MOCK UI'));
});
