const test = require('node:test');
const assert = require('node:assert/strict');
const { createFederationClient, createSSEParser, errorMessage } = require('../src/federation-client');
const PREFIX = '/api/lgu-activities/v1/live/';
const context = () => ({ principal: { id: 'principal', role: 'viewer', identityKind: 'guest',
  displayName: 'Guest', canHost: false }, themes: null,
sessions: [{ id: 'room', themeTitle: 'History', phase: 'lobby', joined: false, live: true }] });
const state = () => ({ session: { id: 'room', themeTitle: 'History', phase: 'lobby', phaseVersion: 0, questionIndex: 0,
  questionCount: 2, lastSeq: 5, role: 'participant', participants: [], standings: [], me: null, own: null, question: null } });
const json = value => ({ ok: true, json: async () => value });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function clock() {
  let counter = 0;
  const pending = new Map();
  return { pending, setTimeout(fn, ms) { const key = ++counter; pending.set(key, { fn, ms }); return key; },
    clearTimeout(key) { pending.delete(key); },
    async tick(ms) {
      const item = [...pending].find(([, task]) => task.ms === ms);
      assert.ok(item, `expected a ${ms}ms timer`);
      pending.delete(item[0]); await item[1].fn(); await flush();
    } };
}

test('all fixed POST routes carry BBB plus optional Core proof, exact bodies and same-origin policies', async () => {
  const requests = [];
  const values = { context: context(), create: { session: { id: 'room', phase: 'lobby', entry: 'closed' } },
    enter: { sessionId: 'room', participant: { participantId: 'person', kind: 'guest', displayName: 'Guest' }, created: true },
    state: state(), command: { phase: 'open', phaseVersion: 4 }, answer: { accepted: true, elapsedMs: 1200 } };
  const client = createFederationClient({ sessionToken: 'bbb-proof', coreToken: 'core-proof',
    fetchImpl: async (url, options) => { requests.push({ url, options }); return json(values[url.slice(PREFIX.length)]); } });
  try {
    assert.deepEqual(await client.context(), values.context);
    assert.deepEqual(await client.create('history'), values.create);
    assert.deepEqual(await client.enter('room'), values.enter);
    assert.deepEqual(await client.state('room'), values.state);
    assert.deepEqual(await client.command('room', 'open', 3), values.command);
    assert.deepEqual(await client.answer('room', 1, 4, ['b', 'a']), values.answer);
    assert.deepEqual(requests.map(r => [r.url, JSON.parse(r.options.body)]), [
      [PREFIX + 'context', {}], [PREFIX + 'create', { topicId: 'history' }],
      [PREFIX + 'enter', { sessionId: 'room' }], [PREFIX + 'state', { sessionId: 'room' }],
      [PREFIX + 'command', { sessionId: 'room', action: 'open', expectedVersion: 3 }],
      [PREFIX + 'answer', { sessionId: 'room', questionIndex: 1, phaseVersion: 4, answer: ['b', 'a'] }],
    ]);
    for (const { options } of requests) {
      assert.equal(options.method, 'POST'); assert.equal(options.mode, 'same-origin');
      assert.equal(options.credentials, 'same-origin'); assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store'); assert.ok(options.signal instanceof AbortSignal);
      assert.deepEqual(options.headers, { 'Content-Type': 'application/json', Accept: 'application/json',
        'X-BBB-Session-Token': 'bbb-proof', Authorization: 'Bearer core-proof' });
    }
  } finally { client.dispose(); }
});

test('valid guest has no Bearer, browser never reads Set-Cookie and credential JSON is refused', async () => {
  let headers;
  let value = context();
  const client = createFederationClient({ sessionToken: 'bbb', fetchImpl: async (_, options) => {
    headers = options.headers;
    return { ...json(value), headers: { get() { assert.fail('JSON must not read cookie headers'); } } };
  } });
  try {
    await client.context(); assert.equal(headers.Authorization, undefined); assert.equal(headers.Cookie, undefined);
    for (const key of ['secret', 'credential', 'credentials', 'ticket', 'token', 'Set-Cookie']) {
      value = { ...context(), [key]: { token: 'never-display' } };
      await assert.rejects(client.context(), { code: 'INVALID_RESPONSE' });
    }
  } finally { client.dispose(); }
});

test('401 latches expiry, 409 is stale, errors sanitized, commands and answers never retried', async () => {
  for (const status of [401, 403, 409, 500]) {
    let count = 0;
    const client = createFederationClient({ sessionToken: 'bbb', fetchImpl: async () => {
      count++; return { ok: false, status, json() { assert.fail('do not expose error body'); } };
    } });
    const code = { 401: 'EXPIRED', 403: 'DENIED', 409: 'STALE', 500: 'UNAVAILABLE' }[status];
    try {
      await assert.rejects(client.command('room', 'start', 0), { code });
      assert.equal(count, 1);
      await assert.rejects(client.answer('room', 0, 2, ['a']), { code });
      assert.equal(count, status === 401 ? 1 : 2);
      assert.doesNotMatch(errorMessage({ code, message: 'secret stack or URL' }), /secret|stack|URL/);
    } finally { client.dispose(); }
  }
  let count = 0;
  const client = createFederationClient({ sessionToken: 'bbb', fetchImpl: async () => { count++; throw new Error('private URL credential'); } });
  await assert.rejects(client.answer('room', 0, 2, ['a']), { code: 'UNAVAILABLE', message: 'UNAVAILABLE' });
  assert.equal(count, 1); client.dispose();
});

test('malformed shapes and object answers fail closed; closed entry is a string, not an object', async () => {
  let value;
  const client = createFederationClient({ sessionToken: 'bbb', fetchImpl: async () => json(value) });
  try {
    value = { ...context(), principal: { ...context().principal, canHost: true } };
    await assert.rejects(client.context(), { code: 'INVALID_RESPONSE' });
    value = { session: { id: 'room', phase: 'lobby', entry: { live: 'closed' } } };
    await assert.rejects(client.create('history'), { code: 'INVALID_RESPONSE' });
    value = state(); value.session.id = 'foreign';
    await assert.rejects(client.state('room'), { code: 'INVALID_RESPONSE' });
    await assert.rejects(client.answer('room', 0, 1, { optionId: 'a' }), { code: 'INVALID_RESPONSE' });
    await assert.rejects(client.command('room', 'invented', 0), { code: 'INVALID_RESPONSE' });
  } finally { client.dispose(); }
});

test('SSE parses byte-split UTF8, split CRLF, comments, multiline JSON, IDs and EOF', () => {
  const events = [];
  const parser = createSSEParser(event => events.push(event));
  const bytes = new TextEncoder().encode(': heartbeat\r\nevent: hello\r\ndata: {"name":"Άννα"}\r\n\r\nid: 7\nevent: phase\ndata: {"seq":\ndata: 7}\n\nevent: ping\ndata: {}');
  for (const byte of bytes) parser.push(Uint8Array.of(byte));
  parser.push(undefined, true);
  assert.deepEqual(events, [
    { event: 'hello', data: '{"name":"Άννα"}', id: '' },
    { event: 'phase', data: '{"seq":\n7}', id: '7' },
    { event: 'ping', data: '{}', id: '' },
  ]);
  assert.throws(() => createSSEParser(() => {}).push(new TextEncoder().encode('x'.repeat(65537))), { code: 'INVALID_RESPONSE' });
});

test('POST readable stream refreshes hello/ping/engine events and cancels on stop', async () => {
  const timers = clock();
  const requests = [];
  let streamController;
  let cancelled = 0;
  const modes = [];
  const views = [];
  const client = createFederationClient({ sessionToken: 'bbb', coreToken: 'core', timers,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/state')) return json(state());
      return { ok: true, headers: { get(key) { assert.equal(key, 'content-type'); return 'text/event-stream; charset=utf-8'; } },
        body: new ReadableStream({ start(c) { streamController = c; }, cancel() { cancelled++; } }) };
    } });
  const watch = client.watch('room', { onState: view => views.push(view), onMode: mode => modes.push(mode),
    onError: error => assert.fail(error.message) });
  await flush();
  const streamRequest = requests.find(r => r.url.endsWith('/stream'));
  assert.deepEqual(JSON.parse(streamRequest.options.body), { sessionId: 'room', after: 5 });
  assert.equal(streamRequest.options.method, 'POST'); assert.equal(streamRequest.options.headers.Accept, 'text/event-stream');
  assert.equal(streamRequest.options.headers.Authorization, 'Bearer core');
  for (const event of ['hello', 'ping', 'phase', 'answered', 'removed']) {
    const before = views.length;
    streamController.enqueue(new TextEncoder().encode(`id: 8\nevent: ${event}\ndata: {"seq":8}\n\n`));
    await flush(); assert.ok(views.length > before, event);
  }
  assert.ok(modes.includes('streaming'));
  watch.stop(); await flush();
  assert.equal(streamRequest.options.signal.aborted, true); assert.equal(cancelled, 1);
  assert.equal(timers.pending.size, 0); client.dispose();
});

test('unavailable stream polls at exactly 3s and cleanup clears polling and suppresses late state', async () => {
  const timers = clock();
  let reads = 0;
  const modes = [];
  const client = createFederationClient({ sessionToken: 'bbb', timers, fetchImpl: async url => {
    if (url.endsWith('/state')) { reads++; return json(state()); }
    return { ok: true, headers: { get: () => 'text/event-stream' }, body: null };
  } });
  const watch = client.watch('room', { onState() {}, onMode: mode => modes.push(mode), onError: assert.fail });
  await flush(); assert.equal(reads, 1); assert.ok(modes.includes('polling'));
  await timers.tick(3000); assert.equal(reads, 2);
  watch.stop(); await flush(); assert.equal(timers.pending.size, 0); client.dispose();
});

test('bounded stream reconnects use latest cursor and fall back, never re-enter or mutate', async () => {
  const timers = clock();
  let streams = 0;
  const routes = [];
  const client = createFederationClient({ sessionToken: 'bbb', timers, fetchImpl: async (url, options) => {
    routes.push(url); if (url.endsWith('/state')) return json(state());
    streams++; assert.deepEqual(JSON.parse(options.body), { sessionId: 'room', after: 5 });
    throw new Error('network lost');
  } });
  client.watch('room', { onState() {}, onError: assert.fail });
  await flush();
  for (const delay of [1000, 2000, 4000]) await timers.tick(delay);
  assert.equal(streams, 4);
  await timers.tick(3000); assert.equal(streams, 4);
  assert.ok(routes.every(url => /\/(state|stream)$/.test(url)));
  client.dispose(); assert.equal(timers.pending.size, 0);
});

test('valid orderly bounded stream renewals do not exhaust the reconnect budget', async () => {
  const timers = clock(); const modes = []; let streams = 0;
  const client = createFederationClient({ sessionToken: 'bbb', timers, fetchImpl: async url => {
    if (url.endsWith('/state')) return json(state());
    streams++;
    return new Response('event: hello\ndata: {"seq":5}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  client.watch('room', { onState() {}, onMode: m => modes.push(m), onError: assert.fail });
  await flush();
  for (let i = 0; i < 6; i++) await timers.tick(1000);
  assert.equal(streams, 7);
  assert.equal(modes.includes('polling'), false);
  client.dispose(); await flush(); assert.equal(timers.pending.size, 0);
});

test('empty EOF streams exhaust the bounded budget and fall back without mutations', async () => {
  const timers = clock(); const modes = []; let streams = 0;
  const client = createFederationClient({ sessionToken: 'bbb', timers, fetchImpl: async url => {
    if (url.endsWith('/state')) return json(state());
    streams++; return new Response('', { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  client.watch('room', { onState() {}, onMode: m => modes.push(m), onError: assert.fail });
  await flush();
  for (const ms of [1000, 2000, 4000]) await timers.tick(ms);
  assert.equal(streams, 4); assert.equal(modes.includes('polling'), true);
  client.dispose(); await flush(); assert.equal(timers.pending.size, 0);
});

test('401 on stream or failed state stops watch without fallback or automatic context', async () => {
  for (const failedRoute of ['state', 'stream']) {
    const timers = clock(); const routes = []; const errors = [];
    const client = createFederationClient({ sessionToken: 'bbb', timers, fetchImpl: async url => {
      routes.push(url); return url.endsWith('/' + failedRoute) ? { ok: false, status: 401 } : json(state());
    } });
    client.watch('room', { onState() {}, onError: error => errors.push(error.code) });
    await flush(); assert.deepEqual(errors, ['EXPIRED']); assert.equal(timers.pending.size, 0);
    assert.ok(!routes.some(url => url.endsWith('/context'))); client.dispose();
  }
});

test('dispose aborts in-flight JSON request and prevents further proof use', async () => {
  let signal;
  const client = createFederationClient({ sessionToken: 'bbb', fetchImpl: (_, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('private abort')), { once: true }));
  } });
  const pending = client.context(); client.dispose();
  assert.equal(signal.aborted, true); await assert.rejects(pending, { code: 'UNAVAILABLE' });
  await assert.rejects(client.context(), { code: 'DENIED' });
});

test('request timeout aborts once, sanitizes failure and clears its timer', async () => {
  const timers = clock(); let requests = 0; let signal;
  const client = createFederationClient({ sessionToken: 'bbb', timers, fetchImpl: (_, options) => {
    requests++; signal = options.signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('private timeout')), { once: true }));
  } });
  const pending = assert.rejects(client.command('room', 'start', 0), { code: 'UNAVAILABLE' });
  await timers.tick(10000); await pending;
  assert.equal(signal.aborted, true); assert.equal(requests, 1); assert.equal(timers.pending.size, 0);
  client.dispose();
});

test('late state after stop is not delivered and cannot open a stream', async () => {
  const timers = clock(); let release; const routes = []; const views = []; const errors = [];
  const client = createFederationClient({ sessionToken: 'bbb', timers, fetchImpl: url => {
    routes.push(url); return new Promise(resolve => { release = () => resolve(json(state())); });
  } });
  const watch = client.watch('room', { onState: value => views.push(value), onError: err => errors.push(err) });
  watch.stop(); release(); await flush();
  assert.deepEqual(views, []); assert.deepEqual(errors, []); assert.deepEqual(routes, [PREFIX + 'state']);
  assert.equal(timers.pending.size, 0); client.dispose();
});

test('malformed state phase/question or participant data fails closed', async () => {
  let value;
  const client = createFederationClient({ sessionToken: 'bbb', fetchImpl: async () => json(value) });
  for (const broken of [
    { phase: 'open', question: null }, { questionCount: 0 },
    { participants: [null] }, { participants: [{ participantId: 'person', eligible: 'true' }] },
    { own: { submitted: ['a'], correct: true, points: 2, elapsedMs: -1, late: false } },
  ]) {
    value = state(); Object.assign(value.session, broken);
    await assert.rejects(client.state('room'), { code: 'INVALID_RESPONSE' });
  }
  client.dispose();
});