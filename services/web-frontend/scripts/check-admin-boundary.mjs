import assert from 'node:assert/strict';
import { build } from 'vite';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const bundle = await build({
  root,
  logLevel: 'error',
  build: { write: false },
});
const modules = bundle.output
  .filter((file) => file.type === 'chunk')
  .flatMap((file) => Object.keys(file.modules));
for (const module of modules)
  assert.doesNotMatch(
    module.replaceAll('\\', '/'),
    /\/(tests|preview)\/|mockAdminMenuAdapter|adminMenuFixtures|mockMenus\.js/,
    module,
  );
assert.ok(modules.some((module) => module.includes('AdminApp.jsx')));
for (const file of (
  await readdir(resolve(root, 'dist'), { recursive: true })
).filter((name) => /\.(html|js|css)$/.test(name))) {
  const source = await readFile(resolve(root, 'dist', file), 'utf8');
  for (const marker of [
    'fixture-only-password',
    '/__admin-integration',
    '/__dashboard/',
    '/__cooking/',
    'admin-integration-access-',
    'HTTP FIXTURE PREVIEW',
    'admin@example.test',
    'customer@example.test',
    'adminIntegration',
  ])
    assert.ok(!source.includes(marker), `${file}: ${marker}`);
}
console.log(
  'Product includes real admin adapters; no preview, mock data, credentials or fixture modules.',
);
