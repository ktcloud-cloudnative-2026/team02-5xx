import { createServer } from 'vite';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { startAdminOrdersFixture } from './admin-orders-fixture.mjs';
export async function startAdminOrdersPreview({ port = 0 } = {}) {
  const fixture = await startAdminOrdersFixture();
  const server = await createServer({
    plugins: [
      {
        name: 'independent-admin-order-preview',
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (new URL(req.url, 'http://preview').pathname !== '/')
              return next();
            const html = await vite.transformIndexHtml(
              req.url,
              '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="icon" href="data:,"><title>Peak Order 관리자 주문 · HTTP fixture</title></head><body><div id="root"></div><script type="module" src="/tests/admin-orders-entry.jsx"></script></body></html>',
            );
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(html);
          });
        },
      },
    ],
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      proxy: {
        '/api/v1/admin/orders': { target: fixture.url, changeOrigin: false },
        '/__admin-orders': { target: fixture.url, changeOrigin: false },
      },
    },
  });
  await server.listen();
  return {
    ...fixture,
    url: server.resolvedUrls.local[0],
    close: async () => {
      await server.close();
      await fixture.close();
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const preview = await startAdminOrdersPreview({ port: 5273 });
  console.log(
    `Independent React + HTTP fixture only: ${preview.url}#admin-orders`,
  );
  const stop = async () => {
    await preview.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
