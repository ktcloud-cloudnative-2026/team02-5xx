import { startAccountFixture } from './account-fixture.mjs';
const fixture = await startAccountFixture();
console.log(`HTTP fixture only — not actual Auth: ${fixture.url}/#account`);
console.log('Synthetic login: customer@example.test / fixture-only-password');
const stop = async () => {
  await fixture.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
