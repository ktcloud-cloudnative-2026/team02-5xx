import { startDashboardFixture } from '../tests/admin-dashboard-fixture.mjs';
const preview = await startDashboardFixture({
  port: Number(process.env.DASHBOARD_PREVIEW_PORT ?? 5302),
  menuPreview: true,
});
console.log(`Admin dashboard HTTP fixture: ${preview.origin}`);
console.log(
  'Loopback only. Synthetic data, no real service authentication. Existing #132 menu Mock linked separately.',
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await preview.close();
    process.exit(0);
  });
