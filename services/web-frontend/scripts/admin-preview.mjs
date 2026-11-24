import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname } from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Isolated memory build. Does not change customer dist/ or expose an authentication bypass. */
export async function startAdminPreview({ port = 0 } = {}) {
  const result = await build({
    root: resolve(project, 'preview/admin'),
    configFile: false,
    plugins: [react()],
    logLevel: 'error',
    build: { write: false, emptyOutDir: false, assetsInlineLimit: 0 },
  });
  const artifacts = Array.isArray(result)
    ? result.flatMap((item) => item.output)
    : result.output;
  const files = new Map(
    artifacts.map((item) => [
      `/${item.fileName}`,
      Buffer.from(item.type === 'chunk' ? item.code : item.source),
    ]),
  );
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
  };
  const server = createServer((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const key = pathname === '/' ? '/index.html' : pathname;
    if (!files.has(key)) {
      response
        .writeHead(404, { 'Content-Type': 'text/plain' })
        .end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime[extname(key)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : files.get(key));
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    files,
    close: () =>
      new Promise((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      ),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const preview = await startAdminPreview({
    port: Number(process.env.ADMIN_PREVIEW_PORT ?? 0),
  });
  console.log(`Mock administrator preview: ${preview.origin}`);
  console.log(
    'Loopback only. In-memory mock; no API/authentication. Ctrl+C to stop.',
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await preview.close();
      process.exit(0);
    });
}
