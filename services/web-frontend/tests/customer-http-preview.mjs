// Loopback-only contract preview. Product App and clients, fake backend only.
import { startCustomerHttpFixture } from './customer-http-fixture.mjs';
const allowed = [
  'success',
  'declined',
  'unknown',
  'unknown-paid',
  'stock',
  'closed',
  'unavailable',
  'expired',
  'estimate-error',
];
const scenario = process.argv[2] ?? 'success';
if (!allowed.includes(scenario))
  throw new Error(`Choose: ${allowed.join(', ')}`);
const fixture = await startCustomerHttpFixture();
fixture.checkoutControls.scenario = scenario;
console.log(`Contract HTTP preview, NOT actual dev services: ${fixture.url}`);
console.log(
  `Scenario: ${scenario}; synthetic customer@example.test / fixture-only-password`,
);
const stop = async () => {
  await fixture.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
