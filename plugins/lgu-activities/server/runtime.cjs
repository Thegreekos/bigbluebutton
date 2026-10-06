const fs = require('node:fs');
const http = require('node:http');
const { createPrivateKey, createPublicKey } = require('node:crypto');
const { createProductionIdentityService } = require('./production-integration.cjs');
const { createIdentityHttpHandler } = require('./http-handler.cjs');
const { readServiceCredential } = require('./core-introspection.cjs');

const CONFIG = '/etc/bigbluebutton/lgu-activities/adapter.json';
const SIGNING_KEY = '/etc/bigbluebutton/lgu-activities/activity-signing-key.pem';

async function start() {
  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  if (!Array.isArray(config.allowedMeetingIds) || !Array.isArray(config.allowedActivityIds)
    || config.origin !== 'https://meet.thegreekos.com') throw new Error('Invalid config');
  // Startup permission/secret validation; no credential output or positive cache.
  readServiceCredential();
  const fd = fs.openSync(SIGNING_KEY, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let privateKey;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o600) throw new Error('Key permissions');
    privateKey = createPrivateKey(fs.readFileSync(fd));
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Key algorithm');
  } finally { fs.closeSync(fd); }
  const service = await createProductionIdentityService({
    bbbHookUrl: 'http://127.0.0.1:8090/bigbluebutton/connection/checkGraphqlAuthorization',
    allowedMeetingIds: config.allowedMeetingIds,
    resolveActivity: async (id) => config.allowedActivityIds.includes(id),
    privateKey, publicKey: createPublicKey(privateKey), issuer: config.origin,
    audience: 'lgu-activities-adapter-v1', kid: 'bbb4-activity-identity-v1',
  });
  const handler = createIdentityHttpHandler({ service, origin: config.origin });
  const server = http.createServer((request, response) => {
    if (request.url === '/healthz' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ status: 'ready', scoped: true })); return;
    }
    handler(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(503);
      response.end();
    });
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 40;
  server.on('error', () => { console.error('LGU adapter runtime FAIL'); process.exitCode = 1; });
  server.listen(4703, '127.0.0.1', () => console.log('LGU adapter runtime READY (loopback, meeting-scoped)'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
}
if (require.main === module) start().catch(() => { console.error('LGU adapter startup FAIL'); process.exitCode = 1; });
module.exports = { start };