import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminMenuApi } from '../src/data/admin/adminMenuApi.js';
import { createAdminOrderApi } from '../src/admin-orders/adminOrderApi.js';
import { createInventoryAdminApi } from '../src/admin-inventory/inventoryAdminApi.js';
import { createDashboardApi } from '../src/admin-dashboard/dashboardApi.js';
import { createCookingApi } from '../src/admin-cooking/cookingApi.js';

const reads = [
  ['menu detail', (request) => createAdminMenuApi({ request }).detail(1)],
  ['order detail', (request) => createAdminOrderApi({ request }).detail(1)],
  ['inventory list', (request) => createInventoryAdminApi({ request }).list()],
  [
    'dashboard operations',
    (request) => createDashboardApi({ request }).read('operations'),
  ],
  [
    'cooking overview',
    (request) => createCookingApi({ request }).get('overview'),
  ],
];
const writes = [
  [
    'menu POST',
    (request) =>
      createAdminMenuApi({ request }).create({
        categoryId: 1,
        name: '검수 메뉴',
        basePrice: 1000,
        cookTimeSec: 60,
        status: 'PAUSED',
      }),
  ],
  [
    'menu PATCH',
    (request) => createAdminMenuApi({ request }).update(1, { name: '수정' }),
  ],
  [
    'menu status PATCH',
    (request) => createAdminMenuApi({ request }).changeStatus(1, 'ON_SALE'),
  ],
  [
    'inventory POST',
    (request) =>
      createInventoryAdminApi({ request }).create({
        stockQty: 1,
        lowStockThreshold: 0,
      }),
  ],
  [
    'inventory adjustment POST',
    (request) =>
      createInventoryAdminApi({ request }).restock(1, { quantity: 1 }),
  ],
  [
    'inventory link PUT',
    (request) => createInventoryAdminApi({ request }).link(1, { menuId: null }),
  ],
  [
    'inventory DELETE',
    (request) => createInventoryAdminApi({ request }).remove(1),
  ],
  [
    'dashboard PATCH',
    (request) => createDashboardApi({ request }).update('isOpen', true),
  ],
];

for (const [name, run] of reads)
  for (const status of [401, 403])
    for (const type of ['text/plain', 'application/json']) {
      test(`${name}: ${type} ${status} is rejected before any JSON read`, async () => {
        let sends = 0,
          jsonReads = 0;
        await assert.rejects(
          run(async () => {
            sends++;
            const response = new Response(
              type === 'text/plain'
                ? 'Gateway denied'
                : JSON.stringify({
                    success: false,
                    errorCode: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
                  }),
              { status, headers: { 'Content-Type': type } },
            );
            response.json = async () => {
              jsonReads++;
              throw new Error('JSON must not determine authentication status');
            };
            return response;
          }),
          (error) =>
            error.status === status &&
            !['network', 'protocol'].includes(error.kind),
        );
        assert.equal(sends, 1);
        assert.equal(jsonReads, 0);
      });
    }
for (const [name, run] of writes)
  for (const status of [401, 403]) {
    test(`${name}: plain ${status} never parses, retries, or reports an unknown successful write`, async () => {
      let sends = 0,
        jsonReads = 0;
      await assert.rejects(
        run(async () => {
          sends++;
          const response = new Response('Gateway denied', {
            status,
            headers: { 'Content-Type': 'text/plain' },
          });
          response.json = async () => {
            jsonReads++;
            throw new Error('unexpected JSON read');
          };
          return response;
        }),
        (error) => error.status === status && error.uncertain === false,
      );
      assert.equal(sends, 1);
      assert.equal(jsonReads, 0);
    });
  }
