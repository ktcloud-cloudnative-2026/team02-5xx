// Contract HTTP double only. Never imported by the product entry or product bundle.
import { createServer } from 'node:http';
import { categories, menus } from '../src/data/mockMenus.js';

export function menuApiHandler(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (!url.pathname.startsWith('/api/v1/menus')) return false;
  const send = (status, data) => {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify(data));
  };
  const summary = ({ id, categoryId, name, basePrice, status }) => ({
    id,
    categoryId,
    name,
    basePrice,
    status,
    imageUrl: null,
  });
  if (url.pathname === '/api/v1/menus') {
    const sort = url.searchParams.get('sort') ?? 'default';
    const category = url.searchParams.get('categoryId');
    const query = (url.searchParams.get('query') ?? '').trim().toLowerCase();
    if (
      !['default', 'priceAsc', 'priceDesc'].includes(sort) ||
      (category !== null && !/^[1-9]\d*$/.test(category)) ||
      [...url.searchParams.keys()].some(
        (key) => url.searchParams.getAll(key).length > 1,
      )
    ) {
      send(400, {
        success: false,
        errorCode: 'INVALID_REQUEST',
        message: 'Invalid menu query parameters',
      });
      return true;
    }
    const found = menus.filter(
      (menu) =>
        menu.status !== 'HIDDEN' &&
        (category === null || menu.categoryId === Number(category)) &&
        menu.name.toLowerCase().includes(query),
    );
    found.sort((a, b) =>
      sort === 'default'
        ? a.categoryId - b.categoryId || a.id - b.id
        : (sort === 'priceAsc'
            ? a.basePrice - b.basePrice
            : b.basePrice - a.basePrice) || a.id - b.id,
    );
    send(200, {
      success: true,
      data: { categories, menus: found.map(summary) },
      message: 'OK',
    });
  } else {
    const menu = menus.find(
      (item) =>
        url.pathname === `/api/v1/menus/${item.id}` && item.status !== 'HIDDEN',
    );
    if (!menu)
      send(404, {
        success: false,
        message: 'Menu not found',
        errorCode: 'MENU_NOT_FOUND',
      });
    else
      send(200, {
        success: true,
        data: { ...summary(menu), description: null, options: menu.options },
        message: 'OK',
      });
  }
  return true;
}

export async function startMenuApiDouble() {
  const server = createServer((request, response) => {
    if (!menuApiHandler(request, response)) response.writeHead(404).end();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => server.close(done)),
  };
}
