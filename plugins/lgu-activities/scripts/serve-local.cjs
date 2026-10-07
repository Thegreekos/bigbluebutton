const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createIdentityHttpHandler } = require('../server/http-handler.cjs');
const { createLiveHttpHandler } = require('../server/live-http-handler.cjs');

function createLocalServer({ identityService, liveBff } = {}) {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist/manifest.json'), 'utf8'));
  // Explicit route allowlist: never serve secrets/source directories or proxy APIs.
  const routes = new Map([
    ['/', ['tests/local-host.html', 'text/html; charset=utf-8']],
    ['/host.js', ['tests/local-host.js', 'text/javascript; charset=utf-8']],
    ['/react.js', ['node_modules/react/umd/react.development.js', 'text/javascript; charset=utf-8']],
    ['/manifest.json', ['dist/manifest.json', 'application/json']],
    ['/bundle.js', [`dist/${manifest.javascriptEntrypointUrl}`, 'text/javascript; charset=utf-8']],
    [`/${manifest.javascriptEntrypointUrl}`, [`dist/${manifest.javascriptEntrypointUrl}`, 'text/javascript; charset=utf-8']],
  ]);
  let identityHandler;
  let liveHandler;
  const server = http.createServer((request, response) => {
    // Live routes must precede the legacy identity prefix. Even without an
    // injected BFF, use the actual handler's sanitized not-configured response.
    if (request.url.startsWith('/api/lgu-activities/v1/live/')) {
      liveHandler ||= createLiveHttpHandler({ bff: liveBff,
        origin: `http://127.0.0.1:${server.address().port}` });
      void liveHandler(request, response);
      return;
    }
    if (identityService && request.url.startsWith('/api/lgu-activities/v1/')) {
      identityHandler ||= createIdentityHttpHandler({ service: identityService,
        origin: `http://127.0.0.1:${server.address().port}`, allowLoopback: true });
      identityHandler(request, response);
      return;
    }
    const route = routes.get(new URL(request.url, 'http://127.0.0.1').pathname);
    if (!route || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(404); response.end('Not found'); return;
    }
    response.writeHead(200, { 'Content-Type': route[1], 'Cache-Control': 'no-store',
      ...((identityService || liveBff) && route[0] === 'tests/local-host.html'
        ? { 'Set-Cookie': 'fixture-bbb-session=1; HttpOnly; SameSite=Strict; Path=/' } : {}) });
    response.end(request.method === 'HEAD' ? undefined : fs.readFileSync(path.join(root, route[0])));
  });
  return server;
}

if (require.main === module) {
  (async () => {
    const fixture = process.argv.includes('--identity-fixtures') || process.argv.includes('--live-fixtures')
      ? await require('../tests/fixtures/live-browser-fixture.cjs').createLiveBrowserFixture() : null;
    const server = createLocalServer({ identityService: fixture?.identityService, liveBff: fixture?.bff });
    server.listen(4702, '127.0.0.1', () => console.log('Local SDK harness: http://127.0.0.1:4702/ (SYNTHETIC mock LGU responses, not a BBB meeting)'));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { fixture?.bff.dispose(); server.close(); });
  })().catch(() => { console.error('Local harness failed'); process.exitCode = 1; });
}
module.exports = { createLocalServer };