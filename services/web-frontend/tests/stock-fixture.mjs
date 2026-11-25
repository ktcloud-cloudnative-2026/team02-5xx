import { resolve } from 'node:path';
import { startCustomerHttpFixture } from './customer-http-fixture.mjs';
export const stockScenarios = [
  'mixed',
  'normal',
  'sold',
  'short',
  'paused',
  'error',
];
export async function startStockFixture({
  input = resolve('tests/stock-preview-entry.jsx'),
} = {}) {
  const controls = {
    status: 200,
    delay: 0,
    quantities: new Map(),
    mode: '',
    requests: [],
  };
  const seed = (scenario) => {
    controls.status = scenario === 'error' ? 503 : 200;
    controls.mode = '';
    controls.delay = 0;
    controls.quantities.clear();
    if (scenario === 'mixed')
      for (const [id, quantity] of [
        [1, 10],
        [2, 0],
        [3, 2],
        [4, 0],
      ])
        controls.quantities.set(id, quantity);
    if (scenario === 'sold') controls.quantities.set(1, 0);
    if (scenario === 'short') controls.quantities.set(1, 3);
  };
  seed('mixed');
  const fixture = await startCustomerHttpFixture({
    input,
    async handleRequest(req, res) {
      const url = new URL(req.url, 'http://fixture');
      if (url.pathname === '/__stock/scenario' && req.method === 'POST') {
        const scenario = url.searchParams.get('name');
        if (!stockScenarios.includes(scenario)) {
          res.writeHead(400).end();
          return true;
        }
        seed(scenario);
        res.writeHead(204).end();
        return true;
      }
      if (url.pathname !== '/api/v1/inventory/availability') return false;
      const ids = url.searchParams.get('menuIds')?.split(',').map(Number) ?? [];
      controls.requests.push([...ids]);
      const status = controls.status;
      const mode = controls.mode;
      let data = ids.map((menuId) => ({
        menuId,
        availableQty: controls.quantities.get(menuId) ?? 50,
        orderable: (controls.quantities.get(menuId) ?? 50) > 0,
      }));
      if (mode === 'missing') data.pop();
      if (mode === 'duplicate') data.push(data[0]);
      if (controls.delay)
        await new Promise((done) => setTimeout(done, controls.delay));
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: status === 200,
          data: status === 200 ? data : null,
          message: 'Synthetic Inventory HTTP fixture',
          ...(status === 200 ? {} : { errorCode: 'INTERNAL_ERROR' }),
        }),
      );
      return true;
    },
  });
  return { ...fixture, stockControls: controls, seed };
}
