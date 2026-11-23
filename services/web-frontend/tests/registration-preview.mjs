// Manual Windows-loopback HTTP fixture preview. Never part of the product build.
import { startRegistrationFixture } from './registration-fixture.mjs';
const fixture = await startRegistrationFixture({ preview: true });
console.log(
  `Registration HTTP FIXTURE preview (not actual Auth): ${fixture.url}/?preview=1#menu-list`,
);
console.log(
  'Use the scenario links above the customer page. Use synthetic emails only.',
);
console.log(
  'Existing fixture login: customer@example.test or admin@example.test; fixture-only-password',
);
console.log(
  'New registration responses do not create real accounts or enable new-account login.',
);
const stop = async () => {
  await fixture.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
