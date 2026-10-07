// Localhost HTTP boundary tests only. No real BBB/Core/LGU, no secret files,
// no LGU source execution or modification. Engine notifications are fixture data.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createHmac, createHash } = require('node:crypto');
const { ContractError } = require('../server/identity-service.cjs');
const { PREFIX, createFederationClient } = require('../server/federation-client.cjs');
const { createLiveBff } = require('../server/live-bff.cjs');
const { createLiveHttpHandler } = require('../server/live-http-handler.cjs');

const ROUTE = '/api/lgu-activities/v1/live/';
const SESSION = '22222222-2222-4222-8222-222222222222';
const PRINCIPAL = '11111111-1111-4111-8111-111111111111';
const PLAYER = '33333333-3333-4333-8333-333333333333';
const SECRET = 'S'.repeat(43); const TICKET = 'T'.repeat(43); const FED = 'F'.repeat(43); const LIVE = 'L'.repeat(43);
const UPSTREAM = 'https://lgu.fixture.test';
const encoder = new TextEncoder();
const frame = (event, data, id, eol = '\n') => `${id === undefined ? '' : `id: ${id}${eol}`}event: ${event}${eol}data: ${JSON.stringify(data)}${eol}${eol}`;
function streamResponse(chunks, { stayOpen = false, onCancel = () => {} } = {}) {
  return new Response(new ReadableStream({ start(c) {
    for (const chunk of chunks) c.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
    if (!stayOpen) c.close();
  }, cancel() { onCancel(); } }), { headers: { 'Content-Type': 'text/event-stream; charset=utf-8',
    'Set-Cookie': `lgu_live=${LIVE}; HttpOnly; Max-Age=43200`, 'X-Private-Upstream': SECRET } });
}
const json = (value, cookies = []) => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const line of cookies) headers.append('Set-Cookie', line);
  return new Response(JSON.stringify(value), { headers });
};

async function harness(t, bff) {
  let handler;
  const server = http.createServer((req, res) => { void handler(req, res); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  handler = createLiveHttpHandler({ bff, origin });
  t.after(async () => { bff?.dispose?.(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  // Raw http deliberately preserves paths that WHATWG fetch would normalize.
  function request({ operation = 'context', path = ROUTE + operation, method = 'POST', raw = '{}', headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(origin, { path, method, headers: { Origin: origin, 'Content-Type': 'application/json',
        'X-BBB-Session-Token': 'fixture-bbb', Cookie: 'bbb_fixture=1', ...headers } }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      }); req.on('error', reject); req.end(raw);
    });
  }
  return { server, origin, request };
}
function spyBff(result = { ok: true }) {
  const calls = [];
  return { calls, async handle(...args) { calls.push(args); return typeof result === 'function' ? result(...args) : result; } };
}
function assertBoundary(reply, status, code) {
  assert.equal(reply.status, status, reply.text);
  if (code) assert.deepEqual(JSON.parse(reply.text), { error: code });
  assert.equal(reply.headers['set-cookie'], undefined);
  assert.equal(reply.headers['access-control-allow-origin'], undefined);
  assert.equal(reply.headers['access-control-allow-credentials'], undefined);
  assert.equal(reply.headers['cache-control'], 'no-store');
  assert.equal(reply.headers['x-content-type-options'], 'nosniff');
  assert.match(reply.headers['content-type'], /^application\/json/);
}

// Minimal authoritative fake of identifySelf: only fixture proofs authenticate.
// It returns the runtime contract, not invented auth()/authenticate() methods.
function integration(t, { host = false } = {}) {
  const transport = []; const auth = []; let enters = 0; let streams = 0; let responder;
  const principal = { id: PRINCIPAL, role: host ? 'moderator' : 'viewer', identityKind: 'guest', displayName: 'Fixture', canHost: host };
  const meeting = { key: 'bbb-internal-fixture', name: 'BBB meeting' };
  const identityService = { async identifySelf(proof, body) {
    auth.push({ proof, body }); assert.deepEqual(body, {});
    if (proof.sessionToken !== 'fixture-bbb' || proof.cookie !== 'bbb_fixture=1' || proof.coreToken !== undefined) {
      throw new ContractError('PROOF_INVALID', 401);
    }
    return { expiresAt: 1800000120, identity: { mode: 'guest', organiser: host,
      principalId: 'lgu-identity:fixture-guest', meetingId: meeting.key, participantId: 'w_fixture_guest',
      corePersonId: null, coreIssuer: null } };
  } };
  const client = createFederationClient({ origin: UPSTREAM, issuerId: 'bbb4-fixture', clock: () => 1800000000,
    readSecret: () => SECRET, fetchImpl: async (url, options) => {
      const u = new URL(url); const path = u.pathname + u.search; const headers = new Headers(options.headers);
      const call = { url, path, options, headers, data: options.body ? JSON.parse(options.body) : undefined }; transport.push(call);
      assert.equal(u.origin, UPSTREAM); assert.equal(headers.has('authorization'), false);
      assert.doesNotMatch(JSON.stringify(options), /fixture-bbb|bbb_fixture/);
      if (headers.has('x-lgu-federation-signature')) {
        assert.equal(headers.has('cookie'), false);
        const payload = ['LGU-FEDERATION-V1', 'bbb4-fixture', '1800000000', headers.get('x-lgu-federation-nonce'),
          options.method.toUpperCase(), path, createHash('sha256').update(options.body ?? '').digest('hex')].join('\n');
        assert.equal(headers.get('x-lgu-federation-signature'), createHmac('sha256', SECRET).update(payload).digest('hex'));
      } else { assert.equal(headers.get('origin'), UPSTREAM); assert.equal(headers.get('x-lgu-request'), '1'); }
      if (responder) { const value = responder(call); if (value !== undefined) return value; }
      if (path === PREFIX + 'launch') return json({ ticket: TICKET, expiresIn: 120, principal, meeting });
      if (path === PREFIX + 'activate') return json({ principal, meeting, session: null }, [`lgu_fed=${FED}; HttpOnly; Max-Age=43200`]);
      if (u.pathname === PREFIX + 'context') return json({ principal, meeting,
        themes: host ? [{ id: 'fixture-topic', title: 'Fixture', description: 'Fixture', languages: ['el'], questionCount: 2 }] : null,
        sessions: [{ id: SESSION, topicId: 'fixture-topic', themeTitle: 'Fixture', phase: 'lobby', questionIndex: 0,
          questionCount: 2, participants: 1, createdAt: 1800000000000, joined: enters > 0, live: true }] });
      if (path.endsWith('/enter')) {
        enters++;
        return json({ sessionId: SESSION, participant: { participantId: PLAYER, kind: 'guest', displayName: 'Fixture' }, created: enters === 1 },
          [`lgu_live=${LIVE}; HttpOnly; Max-Age=43200`]);
      }
      if (u.pathname.endsWith('/stream')) { streams++; return streamResponse([frame('hello', { serverTime: 1800000000000, after: Number(u.searchParams.get('after')) })]); }
      throw new Error('Unexpected fixture path');
    } });
  const bff = createLiveBff({ identityService, client }); t.after(() => bff.dispose());
  return { bff, transport, auth, setResponder: value => { responder = value; }, get enters() { return enters; }, get streams() { return streams; } };
}

test('all seven fixed POST paths reach only their mapped operation with exact proof/body and abort signal', async t => {
  const bff = spyBff(operation => operation === 'stream' ? streamResponse([frame('hello', { after: 0 })]) : { ok: true });
  const h = await harness(t, bff);
  const bodies = { context: {}, create: { topicId: 'fixture-topic' }, enter: { sessionId: SESSION }, state: { sessionId: SESSION },
    command: { sessionId: SESSION, action: 'open', expectedVersion: 17 },
    answer: { sessionId: SESSION, questionIndex: 0, phaseVersion: 18, answer: ['b'] }, stream: { sessionId: SESSION, after: 6 } };
  for (const [operation, body] of Object.entries(bodies)) {
    const result = await h.request({ operation, raw: JSON.stringify(body), headers: { Authorization: 'Bearer fixture-core' } });
    assert.equal(result.status, 200); assert.equal(result.headers['set-cookie'], undefined);
    const [actual, proof, sent, signal] = bff.calls.at(-1); assert.equal(actual, operation); assert.deepEqual(sent, body);
    assert.deepEqual(proof, { sessionToken: 'fixture-bbb', coreToken: 'fixture-core', cookie: 'bbb_fixture=1' });
    assert.ok(signal instanceof AbortSignal);
    if (operation !== 'stream') assertBoundary(result, 200);
  }
  assert.equal(bff.calls.length, 7);
  await h.request(); assert.equal(bff.calls.at(-1)[1].coreToken, undefined, 'guest has no synthetic Core subject/token');
});

test('Origin is EXACT: missing, foreign, suffix, credentials, trailing slash and null are denied before BFF', async t => {
  const bff = spyBff(); const h = await harness(t, bff);
  for (const origin of [undefined, 'https://attacker.test', h.origin + '.attacker.test', h.origin + '/',
    h.origin.replace('127.0.0.1', 'localhost'), 'null', 'http://user@' + h.origin.slice(7)]) {
    const headers = origin === undefined ? { Origin: '' } : { Origin: origin };
    assertBoundary(await h.request({ headers }), 403, 'ORIGIN_DENIED');
  }
  assert.equal(bff.calls.length, 0);
  assertBoundary(await h.request(), 200); assert.equal(bff.calls.length, 1);
});

test('fixed paths reject query strings, traversal, encoded paths, absolute URLs and arbitrary upstream routes', async t => {
  const bff = spyBff(); const h = await harness(t, bff);
  for (const path of [ROUTE + 'context?url=https://evil.test', ROUTE + 'state?sessionId=' + SESSION, ROUTE + 'context/',
    ROUTE + 'unknown', ROUTE + 'launch', ROUTE + '../context', ROUTE + '%63ontext', ROUTE + 'state/extra',
    '/api/v1/live/' + SESSION, 'https://evil.test' + ROUTE + 'context', '//evil.test' + ROUTE + 'context']) {
    assertBoundary(await h.request({ path }), 404, 'NOT_FOUND');
  }
  assert.equal(bff.calls.length, 0);
});

test('only POST JSON is accepted; no GET/OPTIONS/CORS fallback', async t => {
  const bff = spyBff(); const h = await harness(t, bff);
  for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) assertBoundary(await h.request({ method, raw: '' }), 405, 'METHOD_DENIED');
  for (const contentType of ['', 'text/plain', 'application/x-www-form-urlencoded', 'application/jsonp']) {
    assertBoundary(await h.request({ headers: { 'Content-Type': contentType } }), 415, 'JSON_REQUIRED');
  }
  assert.equal(bff.calls.length, 0);
  assertBoundary(await h.request({ headers: { 'Content-Type': 'application/json; charset=utf-8' } }), 200);
});

test('16 KiB body boundary is byte-based, including multibyte text; malformed JSON does not reach BFF', async t => {
  const bff = spyBff(); const h = await harness(t, bff);
  for (const raw of ['', '{bad', '{"sessionId":']) assertBoundary(await h.request({ raw }), 400, 'INVALID_BODY');
  assert.equal(bff.calls.length, 0);
  const exactly = JSON.stringify({ padding: 'x'.repeat(16384 - Buffer.byteLength(JSON.stringify({ padding: '' }))) });
  assert.equal(Buffer.byteLength(exactly), 16384); assertBoundary(await h.request({ raw: exactly }), 200);
  assertBoundary(await h.request({ raw: exactly + ' ' }), 413, 'BODY_TOO_LARGE');
  const unicode = JSON.stringify({ padding: 'Ά'.repeat(8192) }); assert.ok(unicode.length < 16384);
  assertBoundary(await h.request({ raw: unicode }), 413, 'BODY_TOO_LARGE'); assert.equal(bff.calls.length, 1);
});

test('malformed Bearer headers fail closed, never downgrade to guest or leak supplied values', async t => {
  const bff = spyBff(); const h = await harness(t, bff);
  for (const Authorization of ['', 'Basic PRIVATE', 'Bearer', 'Bearer one two', 'bearer PRIVATE', 'Bearer\tPRIVATE']) {
    assertBoundary(await h.request({ headers: { Authorization } }), 401, 'CORE_PROOF_INVALID');
  }
  assert.equal(bff.calls.length, 0);
});

test('unconfigured BFF and thrown failures return sanitized JSON with no stack or upstream credentials', async t => {
  const missing = await harness(t, undefined); assertBoundary(await missing.request(), 503, 'FEDERATION_NOT_CONFIGURED');
  for (const error of [new Error(`private stack ${SECRET}`), new ContractError('LGU_401', 401), new ContractError('LGU_409', 409),
    new ContractError('LGU_429', 429), new ContractError('LGU_503', 503)]) {
    const h = await harness(t, spyBff(() => { throw error; })); const reply = await h.request();
    assertBoundary(reply, error instanceof ContractError ? error.status : 503, error instanceof ContractError ? error.code : 'LGU_UNAVAILABLE');
    assert.doesNotMatch(reply.text, /private|stack|SSSSSS|TTTTTT/);
  }
});

test('real BFF rejects arbitrary upstream URLs and browser identity overrides, no network beyond fixed fixture origin', async t => {
  const f = integration(t); const h = await harness(t, f.bff);
  for (const body of [{ url: 'https://evil.test' }, { principalId: PRINCIPAL }, { meetingId: 'external' }, { organiser: true }, { role: 'moderator' }]) {
    assertBoundary(await h.request({ raw: JSON.stringify(body) }), 400, 'INVALID_BODY');
  }
  assert.equal(f.transport.length, 0); assert.equal(f.auth.length, 0);
  assertBoundary(await h.request({ headers: { 'X-BBB-Session-Token': 'not-authorized' } }), 401, 'PROOF_INVALID');
  assert.equal(f.transport.length, 0);
  assertBoundary(await h.request({ operation: 'create', raw: JSON.stringify({ topicId: 'fixture-topic' }) }), 403, 'TEACHER_REQUIRED');
  assert.equal(f.transport.length, 0);
});

test('real BFF never leaks upstream Set-Cookie, launch ticket, credentials or join code over JSON HTTP', async t => {
  const f = integration(t); const h = await harness(t, f.bff);
  const context = await h.request(); assertBoundary(context, 200);
  f.setResponder(c => c.path === `/api/v1/live/${SESSION}` ? json({ session: { id: SESSION, entry: 'closed', role: 'participant',
    code: 'PRIVATECODE', joinPath: '/live/join/PRIVATECODE', pending: [{ nickname: 'private' }],
    credentials: { federation: FED }, nested: { ticket: TICKET, token: LIVE, 'Set-Cookie': LIVE }, own: { points: 73 } } },
  [`lgu_live=${LIVE}; Max-Age=43200`, 'mock_upstream=PRIVATE; HttpOnly']) : undefined);
  const state = await h.request({ operation: 'state', raw: JSON.stringify({ sessionId: SESSION }) }); assertBoundary(state, 200);
  assert.deepEqual(JSON.parse(state.text), { session: { id: SESSION, entry: 'closed', role: 'participant', nested: {}, own: { points: 73 } } });
  assert.doesNotMatch(context.text + state.text, /TTTTTT|FFFFFF|LLLLLL|SSSSSS|PRIVATECODE|mock_upstream/);
  assert.equal(f.enters, 1); assert.equal(f.transport.filter(c => c.path === PREFIX + 'launch').length, 1);
});

test('SSE sanitizes recursive data, strips upstream headers, filters invalid event/ID and preserves split UTF8/multiline JSON', async t => {
  const log = { seq: 7, kind: 'phase', phaseVersion: 2, at: 1800000000000,
    payload: { phase: 'open', title: 'Άννα', ticket: TICKET, code: 'PRIVATECODE', joinPath: '/private', pending: [],
      nested: [{ token: LIVE, cookie: FED, credentials: { account: SECRET }, keep: 'visible' }] } };
  const source = ': heartbeat\n\n' + frame('phase', log, 7) + frame('bad-event', { token: TICKET }, 8)
    + frame('answered', { seq: 8 }, 'not-numeric') + 'event: ping\ndata: {"serverTime":\ndata: 1800000000000}\n\n';
  // Byte-by-byte includes a split inside the Greek UTF8 sequence.
  const bff = spyBff(() => streamResponse([...encoder.encode(source)].map(byte => Uint8Array.of(byte))));
  const h = await harness(t, bff); const reply = await h.request({ operation: 'stream', raw: JSON.stringify({ sessionId: SESSION, after: 6 }) });
  assert.equal(reply.status, 200); assert.match(reply.headers['content-type'], /^text\/event-stream/);
  assert.equal(reply.headers['cache-control'], 'no-store, no-transform'); assert.equal(reply.headers['x-accel-buffering'], 'no');
  assert.equal(reply.headers['set-cookie'], undefined); assert.equal(reply.headers['x-private-upstream'], undefined);
  const safeLog = { ...log, payload: { phase: 'open', title: 'Άννα', nested: [{ keep: 'visible' }] } };
  assert.equal(reply.text, frame('phase', safeLog, 7) + frame('answered', { seq: 8 }) + frame('ping', { serverTime: 1800000000000 }));
  assert.doesNotMatch(reply.text, /TTTT|LLLL|FFFF|SSSS|PRIVATECODE|bad-event|not-numeric/);
});

test('SSE accepts CRLF frame boundaries as ordinary LGU/browser-compatible event streams', async t => {
  const bff = spyBff(() => streamResponse([frame('hello', { after: 5 }, undefined, '\r\n'), frame('phase', { seq: 6 }, 6, '\r\n')]));
  const h = await harness(t, bff); const reply = await h.request({ operation: 'stream' });
  assert.equal(reply.text, frame('hello', { after: 5 }) + frame('phase', { seq: 6 }, 6));
});

test('malformed or oversized SSE frame ends safely without raw data, secret or JSON error in the event channel', async t => {
  for (const chunk of ['event: phase\ndata: {PRIVATE_NOT_JSON}\n\n', 'event: phase\ndata: ' + 'x'.repeat(65537)]) {
    let cancelled = 0;
    const bff = spyBff(() => streamResponse([chunk], { stayOpen: true, onCancel: () => { cancelled++; } }));
    const h = await harness(t, bff); const reply = await h.request({ operation: 'stream' });
    assert.equal(reply.status, 200); assert.equal(reply.text, ''); assert.equal(cancelled, 1);
    assert.equal(reply.headers['set-cookie'], undefined);
  }
});

test('disconnect cancels real BFF upstream reader; explicit reconnect keeps launch/entry once and latest signed cursor', { timeout: 5000 }, async t => {
  const f = integration(t, { host: true }); const h = await harness(t, f.bff);
  let cancelledResolve; const cancelled = new Promise(resolve => { cancelledResolve = resolve; });
  let firstSignal; let streamRequests = 0;
  f.setResponder(call => {
    if (!new URL(call.url).pathname.endsWith('/stream')) return undefined;
    streamRequests++;
    const after = Number(new URL(call.url).searchParams.get('after'));
    if (streamRequests === 1) { firstSignal = call.options.signal;
      return streamResponse([frame('hello', { after }), frame('phase', { seq: 7, phaseVersion: 2 }, 7)],
        { stayOpen: true, onCancel: cancelledResolve });
    }
    return streamResponse([frame('hello', { after }), frame('answered', { seq: 8 }, 8)]);
  });
  await new Promise((resolve, reject) => {
    const req = http.request(h.origin, { path: ROUTE + 'stream', method: 'POST', headers: { Origin: h.origin,
      'Content-Type': 'application/json', 'X-BBB-Session-Token': 'fixture-bbb', Cookie: 'bbb_fixture=1' } }, res => {
      res.once('data', chunk => { assert.match(chunk.toString(), /event: hello/); res.destroy(); req.destroy(); resolve(); });
      res.on('error', error => { if (error.code !== 'ECONNRESET') reject(error); });
    }); req.on('error', error => { if (error.code !== 'ECONNRESET') reject(error); });
    req.end(JSON.stringify({ sessionId: SESSION, after: 5 }));
  });
  await cancelled; assert.equal(firstSignal.aborted, true);
  assert.equal(streamRequests, 1, 'server never performs an automatic SSE retry');
  const reply = await h.request({ operation: 'stream', raw: JSON.stringify({ sessionId: SESSION, after: 7 }) });
  assert.equal(reply.status, 200); assert.equal(reply.headers['set-cookie'], undefined);
  assert.equal(reply.text, frame('hello', { after: 7 }) + frame('answered', { seq: 8 }, 8));
  assert.equal(f.transport.filter(c => c.path === PREFIX + 'launch').length, 1);
  assert.equal(f.transport.filter(c => c.path === PREFIX + 'activate').length, 1); assert.equal(f.enters, 0);
  assert.deepEqual(f.transport.filter(c => new URL(c.url).pathname.endsWith('/stream')).map(c => c.path), [
    PREFIX + `sessions/${SESSION}/stream?principalId=${PRINCIPAL}&after=5`,
    PREFIX + `sessions/${SESSION}/stream?principalId=${PRINCIPAL}&after=7`]);
  assert.equal(f.auth.length, 2);
});

test('guest HTTP reconnect streams use ordinary cookie route and never launch or auto-enter again', async t => {
  const f = integration(t); const h = await harness(t, f.bff);
  for (const after of [0, 8]) {
    const reply = await h.request({ operation: 'stream', raw: JSON.stringify({ sessionId: SESSION, after }) });
    assert.equal(reply.status, 200); assert.equal(reply.text, frame('hello', { serverTime: 1800000000000, after }));
    assert.equal(reply.headers['set-cookie'], undefined);
  }
  assert.equal(f.enters, 1); assert.equal(f.streams, 2); assert.equal(f.auth.length, 2);
  assert.equal(f.transport.filter(c => c.path === PREFIX + 'launch').length, 1);
  for (const c of f.transport.filter(c => new URL(c.url).pathname.endsWith('/stream'))) {
    assert.match(c.path, new RegExp(`^/api/v1/live/${SESSION}/stream\\?after=(0|8)$`));
    assert.ok(c.headers.get('cookie').includes(`lgu_live=${LIVE}`)); assert.equal(c.headers.has('x-lgu-federation-signature'), false);
  }
});