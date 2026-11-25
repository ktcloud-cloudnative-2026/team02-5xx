import { startAdminIntegrationFixture } from '../tests/admin-integration-fixture.mjs';
const fixture = await startAdminIntegrationFixture({
  port: Number(process.env.PORT ?? 5304),
  initialScenario: 'entry',
});
console.log(`Customer/admin integration HTTP fixture: ${fixture.url}/#home`);
for (const event of ['SIGINT', 'SIGTERM'])
  process.on(event, async () => {
    await fixture.close();
    process.exit(0);
  });
