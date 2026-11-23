import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('the menu fallback references an existing valid SVG source asset', async () => {
  const svg = await readFile(
    new URL('../public/images/defaults/menu-placeholder.svg', import.meta.url),
    'utf8',
  );
  assert.match(svg, /^<svg\b/);
  assert.match(svg, /viewBox="0 0 480 480"/);
  assert.match(svg, /<\/svg>\s*$/);
});
