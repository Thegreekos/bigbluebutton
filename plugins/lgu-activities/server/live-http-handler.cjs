const { once } = require('node:events');
const { ContractError } = require('./identity-service.cjs');
const { safeView } = require('./federation-client.cjs');

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
        if (!response.write(output)) await Promise.race([once(response, 'drain'), once(response, 'close')]);
      }
    }
  } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function createLiveHttpHandler({ bff, origin }) {
  return async (request, response) => {
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 20000);
    const stop = () => abort.abort(); response.on('close', stop);
    const reply = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(body));
    };
    try {
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
module.exports = { createLiveHttpHandler, relayEvents };