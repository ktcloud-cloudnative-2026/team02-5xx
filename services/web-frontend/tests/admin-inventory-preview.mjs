import { startInventoryFixture } from './admin-inventory-fixture.mjs';
const fixture = await startInventoryFixture({
  ui: true,
  port: Number(process.env.INVENTORY_PREVIEW_PORT || 5284),
});
console.log(
  `HTTP fixture ONLY — NOT actual Inventory/Auth/Gateway: ${fixture.url}`,
);
console.log(
  '검수 도구에서 정상·빈 목록·오류·지연·응답 유실 시나리오를 적용할 수 있습니다.',
);
for (const event of ['SIGINT', 'SIGTERM'])
  process.on(event, async () => {
    await fixture.close();
    process.exit(0);
  });
