const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function createLocalServer() {
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
  return http.createServer((request, response) => {
    const route = routes.get(new URL(request.url, 'http://127.0.0.1').pathname);
    if (!route || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(404); response.end('Not found'); return;
    }
    response.writeHead(200, { 'Content-Type': route[1], 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : fs.readFileSync(path.join(root, route[0])));
  });
}

if (require.main === module) {
  const server = createLocalServer();
  server.listen(4702, '127.0.0.1', () => console.log('Local SDK harness: http://127.0.0.1:4702/ (not a BBB meeting)'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
module.exports = { createLocalServer };