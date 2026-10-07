const fs = require('node:fs');
const http = require('node:http');
const { createPrivateKey, createPublicKey } = require('node:crypto');
const { createProductionIdentityService } = require('./production-integration.cjs');
const { createIdentityHttpHandler } = require('./http-handler.cjs');
const { createFederationClient } = require('./federation-client.cjs');
const { createLiveBff } = require('./live-bff.cjs');
const { createLiveHttpHandler } = require('./live-http-handler.cjs');

const CONFIG = '/etc/bigbluebutton/lgu-activities/adapter.json';
const SIGNING_KEY = '/etc/bigbluebutton/lgu-activities/activity-signing-key.pem';

async function start() {
  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  if (config.meetingScope !== 'all-verified-bbb' || !Array.isArray(config.allowedActivityIds)
    || config.allowedActivityIds.some(id => typeof id !== 'string' || !id || id.length > 256)
    || config.origin !== 'https://meet.thegreekos.com') throw new Error('Invalid config');
  // Core credential is checked only on a Core request; its outage must not
  // prevent independently authenticated guest meetings from functioning.
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
    resolveActivity: async (id) => config.allowedActivityIds.includes(id),
    privateKey, publicKey: createPublicKey(privateKey), issuer: config.origin,
    audience: 'lgu-activities-adapter-v1', kid: 'bbb4-activity-identity-v1',
  });
  const handler = createIdentityHttpHandler({ service, origin: config.origin });
  // Opt-in only. Existing production identity mode remains unchanged when off.
  const bff = config.federation?.enabled === true ? createLiveBff({ identityService: service,
    client: createFederationClient({ origin: config.federation.origin, issuerId: config.federation.issuerId }),
    pluginCommit: config.federation.pluginCommit ?? 'unreleased' }) : null;
  const liveHandler = createLiveHttpHandler({ bff, origin: config.origin });
  const server = http.createServer((request, response) => {
    if (request.url === '/healthz' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ status: 'ready', meetingScope: 'all-verified-bbb', modes: ['core', 'guest'] })); return;
    }
    const selectedHandler = request.url?.startsWith('/api/lgu-activities/v1/live/') ? liveHandler : handler;
    selectedHandler(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(503);
      response.end();
    });
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 40;
  server.on('error', () => { console.error('LGU adapter runtime FAIL'); process.exitCode = 1; });
  server.listen(4703, '127.0.0.1', () => console.log('LGU adapter runtime READY (loopback, verified BBB meetings)'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { bff?.dispose(); server.close(); });
}
if (require.main === module) start().catch(() => { console.error('LGU adapter startup FAIL'); process.exitCode = 1; });
module.exports = { start };