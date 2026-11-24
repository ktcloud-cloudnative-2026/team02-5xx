import { createServer } from 'vite';
import { startStockFixture } from './stock-fixture.mjs';
const fixture = await startStockFixture();
const server = await createServer({
  plugins: [
    {
      name: 'stock-fixture-entry',
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (new URL(req.url, 'http://localhost').pathname !== '/')
            return next();
          const html = await vite.transformIndexHtml(
            req.url,
            '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Peak Order Inventory HTTP fixture</title></head><body><div id="root"></div><script type="module" src="/tests/stock-preview-entry.jsx"></script></body></html>',
          );
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
        });
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 5264,
    strictPort: true,
    proxy: Object.fromEntries(
      [
        '/__stock',
        ...['auth', 'menus', 'inventory', 'orders', 'cooking'].map(
          (name) => `/api/v1/${name}`,
        ),
      ].map((path) => [path, { target: fixture.url, changeOrigin: false }]),
    ),
  },
});
await server.listen();
console.log(
  'Vite React + synthetic HTTP fixture ONLY: http://127.0.0.1:5264/?scenario=mixed#menu-list',
);
const stop = async () => {
  await server.close();
  await fixture.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
