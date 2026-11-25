// Local, test-only browser fixture. This file is not imported by index.html or bundled into dist.
// The injected session is a UI test double, not a login/JWT implementation.
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'vite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { menuApiHandler } from './menu-api-server.mjs';
import { inventoryFixtureHandler } from './inventory-fixture.mjs';

export async function startUiFixture({
  entryFile,
  input = resolve(entryFile ?? 'tests/browser-fixture-entry.jsx'),
  handleRequest,
  testControls = true,
  previewControls,
  port = 0,
} = {}) {
  const bundle = await build({
    logLevel: 'error',
    build: {
      write: false,
      rollupOptions: { input },
    },
  });
  const files = new Map(
    bundle.output.map((file) => [
      `/${file.fileName}`,
      file.type === 'chunk' ? file.code : file.source,
    ]),
  );
  const entry = bundle.output.find(
    (file) => file.type === 'chunk' && file.isEntry,
  );
  const styles = bundle.output
    .filter((file) => file.fileName.endsWith('.css'))
    .map((file) => `<link rel="stylesheet" href="/${file.fileName}">`)
    .join('');
  const imagePaths = new Set(
    (await readdir(resolve('public/images'), { recursive: true }))
      .filter((file) => /\.(svg|png|webp)$/.test(file))
      .map((file) => `/images/${file.replaceAll('\\', '/')}`),
  );
  const server = http.createServer(async (request, response) => {
    if (handleRequest && (await handleRequest(request, response))) return;
    if (inventoryFixtureHandler(request, response)) return;
    if (menuApiHandler(request, response)) return;
    const url = new URL(request.url, 'http://127.0.0.1');
    if (imagePaths.has(url.pathname)) {
      response.writeHead(200, {
        'Content-Type': url.pathname.endsWith('.svg')
          ? 'image/svg+xml'
          : url.pathname.endsWith('.png')
            ? 'image/png'
            : 'image/webp',
      });
      response.end(await readFile(resolve('public', `.${url.pathname}`)));
      return;
    }
    if (url.pathname === '/') {
      const html = `<!doctype html>
      <html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="icon" href="data:,"><title>Issue 110 UI test fixture</title>${styles}</head>
      <body><div id="root"></div>${
        testControls
          ? `<aside style="position:relative;background:white;border:1px solid #666;padding:8px;font:12px sans-serif">
        UI 테스트 전용 · 실제 인증 아님
        <button id="test-sign-in">검증된 세션 모의 주입</button>
        <button id="test-sign-out">비회원으로 전환</button>
        <button id="test-pending">다음 로그인 안내에서 세션 모의 주입</button>
      </aside>`
          : ''
      }${typeof previewControls === 'function' ? previewControls() : ''}<script type="module" src="/${entry.fileName}"></script></body></html>`;
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
    } else {
      const file = files.get(url.pathname);
      response.writeHead(file === undefined ? 404 : 200, {
        'Content-Type': url.pathname.endsWith('.css')
          ? 'text/css'
          : 'text/javascript',
      });
      response.end(file);
    }
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => server.close(done)),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const fixture = await startUiFixture();
  console.log(`Test-only injected-session UI: ${fixture.url}`);
  const stop = async () => {
    await fixture.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
