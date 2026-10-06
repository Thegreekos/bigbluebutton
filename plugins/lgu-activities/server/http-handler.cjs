const { ContractError } = require('./identity-service.cjs');

function createIdentityHttpHandler({ service, origin, allowLoopback = false }) {
  const url = new URL(origin);
  if (url.origin !== origin || !(url.protocol === 'https:'
    || (allowLoopback && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) && url.protocol === 'http:'))) {
    throw new TypeError('Exact HTTPS browser origin required');
  }
  const routes = new Map([
    ['/api/lgu-activities/v1/self', 'identifySelf'],
    ['/api/lgu-activities/v1/identity', 'identify'],
    ['/api/lgu-activities/v1/contexts', 'createContext'],
    ['/api/lgu-activities/v1/identities', 'issueIdentity'],
    ['/api/lgu-activities/v1/verify', 'verifyIdentity'],
  ]);
  return async (request, response) => {
    const method = routes.get(new URL(request.url, origin).pathname);
    const reply = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(body));
    };
    try {
      if (!method) throw new ContractError('NOT_FOUND', 404);
      if (request.method !== 'POST') throw new ContractError('METHOD_DENIED', 405);
      if (request.headers.origin !== origin) throw new ContractError('ORIGIN_DENIED');
      if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        throw new ContractError('JSON_REQUIRED', 415);
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 16384) throw new ContractError('BODY_TOO_LARGE', 413);
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new ContractError('INVALID_JSON', 400); }
      const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization || '');
      if (request.headers.authorization !== undefined && !match) throw new ContractError('CORE_PROOF_INVALID', 401);
      const proof = { coreToken: match?.[1], sessionToken: request.headers['x-bbb-session-token'], cookie: request.headers.cookie };
      reply(200, await service[method](proof, body));
    } catch (error) {
      reply(error instanceof ContractError ? error.status : 503,
        { error: error instanceof ContractError ? error.code : 'INTEGRATION_UNAVAILABLE',
          ...(error instanceof ContractError && error.code === 'CORE_IDENTITY_INACTIVE' && error.mismatches?.length
            ? { mismatches: error.mismatches.filter((field) => ['personId', 'meetingId', 'role', 'kind'].includes(field)) } : {}) });
    }
  };
}
module.exports = { createIdentityHttpHandler };