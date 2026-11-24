// Loopback-only contract preview. Product App and clients, fake backend only.
import {
  startCustomerHttpFixture,
  checkoutScenarios as allowed,
} from './customer-http-fixture.mjs';
const scenario = process.argv[2] ?? 'success';
if (!allowed.includes(scenario))
  throw new Error(`Choose: ${allowed.join(', ')}`);
const fixture = await startCustomerHttpFixture({ preview: true });
fixture.checkoutControls.scenario = scenario;
console.log(`Contract HTTP preview, NOT actual dev services: ${fixture.url}`);
console.log(
  `Scenario: ${scenario}; synthetic customer@example.test / fixture-only-password`,
);
console.log(
  'STORE_ADMIN: admin@example.test / fixture-only-password. Scenario controls are at the bottom of this same page.',
);
const stop = async () => {
  await fixture.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
