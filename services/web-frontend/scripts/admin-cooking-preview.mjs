import { startCookingFixture } from '../tests/admin-cooking-fixture.mjs';
const fixture = await startCookingFixture({
  port: Number(process.env.COOKING_PREVIEW_PORT ?? 5305),
});
console.log(
  `Cooking HTTP fixture (not real authentication): ${fixture.url}/#admin/cooking`,
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await fixture.close();
    process.exit(0);
  });
