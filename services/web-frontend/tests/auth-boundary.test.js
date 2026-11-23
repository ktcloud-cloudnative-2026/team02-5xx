import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'vite';

test('product bundle excludes injected sessions and the contract Mock HTTP server', async () => {
  const bundle = await build({ logLevel: 'error', build: { write: false } });
  for (const file of bundle.output) {
    if (file.type !== 'chunk') continue;
    assert.ok(
      Object.keys(file.modules).every(
        (id) => !id.replaceAll('\\', '/').includes('/tests/'),
      ),
    );
    assert.doesNotMatch(
      file.code,
      /test-sign-in|fixture-only-password|fixtureRefresh|fixture-access-/,
    );
  }
});
