// Independent loopback HTTP contract double. No backend flags or identity headers.
import http from 'node:http';
import { build } from 'vite';
import { inventoryScenarios } from './admin-inventory-scenarios.js';
import { menuApiHandler } from './menu-api-server.mjs';
const ROOT = '/api/v1/admin/inventory/items';
export function stockRow(
  stockItemId,
  stockQty,
  reservedQty,
  lowStockThreshold,
  menuId = null,
) {
  return {
    stockItemId,
    menuId,
    stockQty,
    reservedQty,
    availableQty: stockQty - reservedQty,
    lowStockThreshold,
    lowStock: stockQty - reservedQty <= lowStockThreshold,
  };
}
export async function startInventoryFixture({ ui = false, port = 0 } = {}) {
  const controls = { scenario: 'normal', listDelay: 0, writeDelay: 0 };
  const requests = [];
  let rows, nextId;
  function reset(scenario = 'normal') {
    Object.assign(controls, { scenario, listDelay: 0, writeDelay: 0 });
    rows =
      scenario === 'empty'
        ? []
        : [
            stockRow(101, 40, 5, 10, 1),
            stockRow(102, 5, 2, 4, 2),
            stockRow(103, 4, 4, 2, 3),
            stockRow(104, 18, 0, 3, 4),
            stockRow(105, 12, 0, 2),
            stockRow(106, 0, 0, 0),
          ];
    nextId = 107;
    if (scenario === 'menu-hidden-name') rows[0].menuId = 999;
  }
  reset();
  let files = new Map(),
    entry,
    styles = '';
  if (ui) {
    const bundle = await build({
      logLevel: 'error',
      build: {
        write: false,
        rollupOptions: { input: 'tests/admin-inventory-entry.jsx' },
      },
    });
    files = new Map(
      bundle.output.map((file) => [
        `/${file.fileName}`,
        file.type === 'chunk' ? file.code : file.source,
      ]),
    );
    entry = bundle.output.find(
      (file) => file.type === 'chunk' && file.isEntry,
    ).fileName;
    styles = bundle.output
      .filter((file) => file.fileName.endsWith('.css'))
      .map((file) => `<link rel="stylesheet" href="/${file.fileName}">`)
      .join('');
  }
  function send(response, status, data, errorCode) {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(
      JSON.stringify({
        success: status < 400,
        data: data ?? null,
        message: status < 400 ? '성공' : 'fixture error',
        ...(errorCode ? { errorCode } : {}),
      }),
    );
  }
  const pause = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/v1/menus')) {
        if (controls.scenario === 'menu-read-error')
          return send(response, 503, null, 'INTERNAL_ERROR');
        if (
          controls.scenario === 'menu-hidden-name' &&
          url.pathname === '/api/v1/menus/999'
        )
          return send(response, 404, null, 'MENU_NOT_FOUND');
        if (menuApiHandler(request, response)) return;
      }
      if (url.pathname === '/__fixture' && request.method === 'POST') {
        let raw = '';
        for await (const chunk of request) raw += chunk;
        const { scenario } = JSON.parse(raw);
        if (!Object.hasOwn(inventoryScenarios, scenario))
          return send(response, 400, null, 'INVALID_REQUEST');
        reset(scenario);
        return send(response, 200, { scenario });
      }
      if (url.pathname.startsWith(ROOT)) {
        let raw = '';
        for await (const chunk of request) raw += chunk;
        const body = raw ? JSON.parse(raw) : undefined;
        requests.push({
          method: request.method,
          path: url.pathname,
          query: url.search,
          body,
          headers: request.headers,
        });
        const scenario = controls.scenario;
        if (request.method === 'GET' && url.pathname === ROOT) {
          const snapshot = structuredClone(
            url.searchParams.get('lowStockOnly') === 'true'
              ? rows.filter((row) => row.lowStock)
              : rows,
          );
          await pause(controls.listDelay || (scenario === 'slow' ? 1500 : 0));
          const error = /^list-(\d+)$/.exec(scenario);
          return error
            ? send(response, Number(error[1]), null, 'NOT_FOUND')
            : send(response, 200, snapshot);
        }
        await pause(controls.writeDelay || (scenario === 'slow' ? 1500 : 0));
        const forced = {
          'write-400': [400, 'INVALID_REQUEST'],
          'write-401': [401, 'UNAUTHORIZED'],
          'write-403': [403, 'FORBIDDEN'],
          'write-404': [404, 'INVENTORY_NOT_FOUND'],
          'in-use': [409, 'STOCK_ITEM_IN_USE'],
          'menu-linked': [409, 'MENU_ALREADY_LINKED'],
          'menu-hidden': [409, 'MENU_NOT_LINKABLE'],
          'menu-unavailable': [503, 'MENU_SERVICE_UNAVAILABLE'],
        }[scenario];
        if (forced) return send(response, forced[0], null, forced[1]);
        let item,
          status = 200;
        if (url.pathname === ROOT && request.method === 'POST') {
          if (
            ![body?.stockQty, body?.lowStockThreshold].every(
              (value) =>
                Number.isInteger(value) && value >= 0 && value <= 2147483647,
            )
          )
            return send(response, 400, null, 'INVALID_REQUEST');
          item = stockRow(nextId++, body.stockQty, 0, body.lowStockThreshold);
          rows.push(item);
          status = 201;
        } else {
          const match = /^\/(\d+)(?:\/(adjustments|menu-link))?$/.exec(
            url.pathname.slice(ROOT.length),
          );
          item = rows.find((row) => row.stockItemId === Number(match?.[1]));
          if (!item) return send(response, 404, null, 'INVENTORY_NOT_FOUND');
          const action = match[2];
          if (action === 'adjustments' && request.method === 'POST') {
            if (
              !Number.isInteger(body?.quantity) ||
              body.quantity < 1 ||
              item.stockQty + body.quantity > 2147483647
            )
              return send(response, 400, null, 'INVALID_REQUEST');
            item.stockQty += body.quantity;
            item.availableQty += body.quantity;
            item.lowStock = item.availableQty <= item.lowStockThreshold;
          } else if (action === 'menu-link' && request.method === 'PUT') {
            if (
              body?.menuId !== null &&
              (!Number.isSafeInteger(body?.menuId) || body.menuId < 1)
            )
              return send(response, 400, null, 'INVALID_REQUEST');
            if (body.menuId !== item.menuId) {
              if ([103, 104].includes(item.stockItemId))
                return send(response, 409, null, 'STOCK_ITEM_IN_USE');
              if (body.menuId === 999)
                return send(response, 409, null, 'MENU_NOT_LINKABLE');
              if (body.menuId === 998)
                return send(response, 503, null, 'MENU_SERVICE_UNAVAILABLE');
              if (body.menuId === 997)
                return send(response, 404, null, 'MENU_NOT_FOUND');
              if (
                body.menuId !== null &&
                rows.some((row) => row.menuId === body.menuId && row !== item)
              )
                return send(response, 409, null, 'MENU_ALREADY_LINKED');
              item.menuId = body.menuId;
            }
          } else if (!action && request.method === 'DELETE') {
            if ([103, 104].includes(item.stockItemId))
              return send(response, 409, null, 'STOCK_ITEM_IN_USE');
            rows = rows.filter((row) => row !== item);
            item = { ...item, menuId: null };
          } else return send(response, 404, null, 'NOT_FOUND');
        }
        if (scenario === 'response-lost') {
          // Deliver headers first, then cut the body. Closing before any headers
          // may trigger the browser transport's own connection replay.
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.write('{"success":true,"data":');
          await pause(30);
          response.destroy();
          return;
        }
        return send(response, status, item);
      }
      if (ui && url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return response.end(
          `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Peak Order · 관리자 재고 HTTP fixture</title>${styles}</head><body><div id="root"></div><script type="module" src="/${entry}"></script></body></html>`,
        );
      }
      if (files.has(url.pathname)) {
        response.writeHead(200, {
          'Content-Type': url.pathname.endsWith('.css')
            ? 'text/css'
            : 'text/javascript',
        });
        return response.end(files.get(url.pathname));
      }
      send(response, 404, null, 'NOT_FOUND');
    } catch {
      if (!response.headersSent && !response.destroyed)
        send(response, 400, null, 'INVALID_REQUEST');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    controls,
    requests,
    reset,
    rows: () => structuredClone(rows),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
