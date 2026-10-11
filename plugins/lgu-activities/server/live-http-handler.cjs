const { ContractError } = require('./identity-service.cjs');
const { safeView, validPrivateResourcePath } = require('./federation-client.cjs');
const PLAYER_PREFIX = '/api/lgu-activities/v1/player';

function waitForDrain(response, signal) {
  return new Promise(resolve => {
    const done = () => {
      response.off('drain', done); response.off('close', done);
      signal.removeEventListener('abort', done); resolve();
    };
    response.once('drain', done); response.once('close', done);
    signal.addEventListener('abort', done, { once: true });
    if (response.destroyed || signal.aborted) done();
  });
}

// Streams carry sanitized engine notifications, not credential response headers.
async function relayEvents(upstream, response, signal) {
  const reader = upstream.body.getReader(); const decoder = new TextDecoder();
  let buffer = '';
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (!signal.aborted) {
      const chunk = await reader.read(); if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 65536) throw new Error('bounded stream frame');
      let at;
      let separator;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        at = separator.index;
        const frame = buffer.slice(0, at); buffer = buffer.slice(at + separator[0].length);
        const lines = frame.split(/\r?\n/);
        const event = lines.find(l => l.startsWith('event:'))?.slice(6).trim();
        const id = lines.find(l => l.startsWith('id:'))?.slice(3).trim();
        const raw = lines.filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!event || !/^[a-z_]{1,64}$/.test(event) || !raw) continue;
        const data = safeView(JSON.parse(raw));
        const output = `${id && /^\d{1,15}$/.test(id) ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        if (!response.write(output)) await waitForDrain(response, signal);
      }
    }
  } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function relayResource(upstream, response, signal) {
  const reader = upstream.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!response.write(Buffer.from(chunk.value))) await waitForDrain(response, signal);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function nativePlayerRoute(rawUrl, origin) {
  if (!rawUrl.startsWith(`${PLAYER_PREFIX}/`)) return null;
  const url = new URL(rawUrl, origin);
  const pathname = url.pathname.slice(PLAYER_PREFIX.length);
  const live = /^\/api\/v1\/live\/([\da-f-]{36})(?:\/(stream|answer))?$/i.exec(pathname);
  if (live) {
    const allowed = live[2] === 'stream' ? ['after', 'lang'] : ['lang'];
    for (const key of url.searchParams.keys()) {
      if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw new ContractError('NOT_FOUND', 404);
    }
    const lang = url.searchParams.get('lang');
    if (lang !== null && !['el', 'en'].includes(lang)) throw new ContractError('INVALID_BODY', 400);
    if (live[2] === 'stream' && !/^\d{1,15}$/.test(url.searchParams.get('after') || '')) {
      throw new ContractError('INVALID_BODY', 400);
    }
    return { kind: live[2] || 'state', sessionId: live[1], after: Number(url.searchParams.get('after') || 0) };
  }
  const resourcePath = pathname + url.search;
  if (pathname === '/api/audio' || pathname.startsWith('/media/')) return { kind: 'resource', resourcePath };
  throw new ContractError('NOT_FOUND', 404);
}
function createLiveHttpHandler({ bff, origin }) {
  return async (request, response) => {
    const playerRequest = request.url?.startsWith(`${PLAYER_PREFIX}/`);
    const isStream = playerRequest && /\/api\/v1\/live\/[\da-f-]{36}\/stream(?:\?|$)/i.test(request.url);
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), isStream ? 12 * 60 * 60 * 1000 : 20000);
    const stop = () => abort.abort(); response.on('close', stop);
    const reply = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(body));
    };
    try {
      if (playerRequest) {
        const originlessSameOriginRead = request.method === 'GET' && request.headers.origin === undefined
          && request.headers['sec-fetch-site'] === 'same-origin';
        if (request.headers.origin !== origin && !originlessSameOriginRead) throw new ContractError('ORIGIN_DENIED', 403);
        const route = nativePlayerRoute(request.url, origin);
        const authorization = request.headers.authorization;
        const bearer = authorization === undefined ? null : /^Bearer ([^\s]+)$/.exec(authorization);
        if (authorization !== undefined && !bearer) throw new ContractError('CORE_PROOF_INVALID', 401);
        if (!bff) throw new ContractError('FEDERATION_NOT_CONFIGURED', 503);
        const proof = { sessionToken: request.headers['x-bbb-session-token'], coreToken: bearer?.[1], cookie: request.headers.cookie };
        if (route.kind === 'resource') {
          if (request.method !== 'GET') throw new ContractError('METHOD_DENIED', 405);
          if (!validPrivateResourcePath(route.resourcePath)) throw new ContractError('NOT_FOUND', 404);
          const upstream = await bff.handlePlayerResource(route.resourcePath, proof, abort.signal, {
            accept: request.headers.accept, client: request.headers['x-lgu-client'],
          });
          const headers = new Headers(upstream.headers);
          const safeHeaders = { 'Content-Type': headers.get('content-type') || 'application/octet-stream',
            'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
          for (const name of ['content-length', 'content-range', 'accept-ranges']) {
            const value = headers.get(name); if (value) safeHeaders[name] = value;
          }
          response.writeHead(upstream.status, safeHeaders);
          await relayResource(upstream, response, abort.signal);
          response.end(); return;
        }
        let body = {};
        if (route.kind === 'answer') {
          if (request.method !== 'POST') throw new ContractError('METHOD_DENIED', 405);
          if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json'
            || request.headers['x-lgu-request'] !== '1') throw new ContractError('JSON_REQUIRED', 415);
          const chunks = []; let size = 0;
          for await (const chunk of request) { size += chunk.length; if (size > 16384) throw new ContractError('BODY_TOO_LARGE', 413); chunks.push(chunk); }
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ContractError('INVALID_BODY', 400); }
          if (!body || Array.isArray(body) || typeof body !== 'object'
            || Object.keys(body).length !== 3
            || !['answer', 'phaseVersion', 'questionIndex'].every(key => Object.hasOwn(body, key))) {
            throw new ContractError('INVALID_BODY', 400);
          }
        } else if (request.method !== 'GET') throw new ContractError('METHOD_DENIED', 405);
        const operationBody = route.kind === 'answer'
          ? { sessionId: route.sessionId, ...body }
          : route.kind === 'stream' ? { sessionId: route.sessionId, after: route.after }
            : { sessionId: route.sessionId };
        const result = await bff.handlePlayer(route.kind, proof, operationBody, abort.signal);
        if (route.kind === 'stream') {
          response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' });
          await relayEvents(result, response, abort.signal); response.end(); return;
        }
        reply(200, safeView(result)); return;
      }
      const match = /^\/api\/lgu-activities\/v1\/live\/(context|create|enter|state|stream|command|answer)$/.exec(request.url);
      if (!match) throw new ContractError('NOT_FOUND', 404);
      if (request.method !== 'POST') throw new ContractError('METHOD_DENIED', 405);
      if (request.headers.origin !== origin) throw new ContractError('ORIGIN_DENIED', 403);
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new ContractError('JSON_REQUIRED', 415);
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 16384) throw new ContractError('BODY_TOO_LARGE', 413); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new ContractError('INVALID_BODY', 400); }
      const authorization = request.headers.authorization;
      const bearer = authorization === undefined ? null : /^Bearer ([^\s]+)$/.exec(authorization);
      if (authorization !== undefined && !bearer) throw new ContractError('CORE_PROOF_INVALID', 401);
      if (!bff) throw new ContractError('FEDERATION_NOT_CONFIGURED', 503);
      const result = await bff.handle(match[1], { sessionToken: request.headers['x-bbb-session-token'],
        coreToken: bearer?.[1], cookie: request.headers.cookie }, body, abort.signal);
      if (match[1] === 'stream') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' });
        await relayEvents(result, response, abort.signal); response.end();
      } else reply(200, result);
    } catch (error) {
      if (response.headersSent) response.end();
      else reply(error instanceof ContractError ? error.status : 503,
        { error: error instanceof ContractError ? error.code : 'LGU_UNAVAILABLE' });
    } finally { clearTimeout(timer); response.off('close', stop); }
  };
}
module.exports = { createLiveHttpHandler, relayEvents, relayResource, nativePlayerRoute };