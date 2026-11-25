// Vite product entry + synthetic HTTP backend. Never points at real services.
import { createServer } from 'vite';
import { startAccountFixture } from './account-fixture.mjs';
const fixture = await startAccountFixture();
const server = await createServer({
  server: {
    host: '127.0.0.1',
    port: 5260,
    strictPort: true,
    proxy: Object.fromEntries(
      ['auth', 'menus', 'orders', 'cooking'].map((service) => [
        `/api/v1/${service}`,
        { target: fixture.url, changeOrigin: false },
      ]),
    ),
  },
});
await server.listen();
console.log(
  'Vite React preview + HTTP fixture ONLY: http://127.0.0.1:5260/#account',
);
console.log('Synthetic login: customer@example.test / fixture-only-password');
const stop = async () => {
  await server.close();
  await fixture.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
