// Customer screen with a controlled contract HTTP double; no session/auth injection.
import { createServer } from 'vite';
import { startMenuApiDouble } from './menu-api-server.mjs';

const mock = await startMenuApiDouble();
const vite = await createServer({
  server: {
    host: '127.0.0.1',
    port: 0,
    proxy: { '/api/v1/menus': { target: mock.url, changeOrigin: true } },
  },
});
await vite.listen();
console.log(
  `Customer preview (Mock HTTP API, NOT real Menu Service): http://127.0.0.1:${vite.httpServer.address().port}`,
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await vite.close();
    await mock.close();
    process.exit(0);
  });
