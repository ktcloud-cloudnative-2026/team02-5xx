// Isolated local UI preview, not a product route or authentication mechanism.
import { startUiFixture } from './ui-fixture.mjs';
const fixture = await startUiFixture({
  entryFile: 'tests/checkout-browser-entry.jsx',
});
console.log(
  `Checkout UI test preview (injected CUSTOMER, not authentication): ${fixture.url}/#cart`,
);
console.log(
  'Seed a cart through the existing menu, or open a menu and choose immediate order.',
);
for (const scenario of [
  'success',
  'declined',
  'unknown',
  'unknown-paid',
  'create-failed',
])
  console.log(`${scenario}: ${fixture.url}/?scenario=${scenario}`);
const stop = async () => {
  await fixture.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
