// SYNTHETIC ONLY. Contract reference: read-only /tmp/lgu-federation-36cd87f9/
// docs/BBB4_FEDERATION.md, app/api.ts, src/server/{federation,live}.ts.
// This is an adapter/transport test, NOT an LGU engine or database test. State changes
// below are explicitly selected response fixtures; 73 is a MOCK engine-provided mark.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, createHmac } = require('node:crypto');
const { ContractError } = require('../server/identity-service.cjs');
const { PREFIX, signatureHeaders, CookieVault, safeView, validPrivateResourcePath, createFederationClient } = require('../server/federation-client.cjs');
const { createLiveBff } = require('../server/live-bff.cjs');
const { version } = require('../package.json');

const ORIGIN = 'https://lgu.fixture.test';
const ISSUER = 'bbb4-fixture';
const SECRET = 'S'.repeat(43); // injected fixture, never readFederationSecret()
const PRINCIPAL = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const PLAYER = '33333333-3333-4333-8333-333333333333';
const FOREIGN = '44444444-4444-4444-8444-444444444444';
const TICKET = 'T'.repeat(43);
const FED = 'F'.repeat(43);
const ACCOUNT = 'A'.repeat(43);
const LIVE = 'L'.repeat(43);
const TOPIC = 'fixture-history';
const proof = { sessionToken: 'fixture-bbb-proof', coreToken: 'fixture-core-proof', cookie: 'bbb_fixture=1' };
const json = (value, cookies = [], status = 200) => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(value), { status, headers });
};
const cookie = (name, token, age = 43200) => `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${age}`;
const clean = value => JSON.parse(JSON.stringify(value));

// Independent oracle: do not call signatureHeaders() to validate signatureHeaders().
function expectedSignature({ issuerId = ISSUER, secret = SECRET, now, nonce, method, path, body }) {
  return createHmac('sha256', secret).update('LGU-FEDERATION-V1\n' + issuerId + '\n' + now + '\n' + nonce
    + '\n' + method.toUpperCase() + '\n' + path + '\n' + createHash('sha256').update(body).digest('hex')).digest('hex');
}
function engineView({ mode = 'core', host = false, phase = 'open', submitted = false } = {}) {
  const reveal = phase === 'reveal';
  const kind = mode === 'core' ? 'account' : 'guest';
  const ms = 1800000000000;
  return { session: {
    id: SESSION, eventId: FOREIGN, eventTitle: 'Fixture meeting', topicId: TOPIC, themeTitle: 'Ιστορία', language: 'el',
    phase, phaseVersion: reveal ? 4 : 2, questionIndex: 0, questionCount: 2,
    openedAt: ms, deadline: ms + 20000, serverTime: ms + 1200, lastSeq: reveal ? 8 : 5,
    role: host ? 'host' : 'participant', hostNickname: 'Fixture host',
    settings: { basePoints: 100, speedBonus: 50, graceMs: 300, bucketMs: 250 },
    entry: 'closed', code: null, joinPath: null, pending: null, eventAccess: host,
    question: { index: 0, total: 2, id: 'fixture-question', kind: 'choice', prompt: 'Ποια επιλογή;',
      options: [{ id: 'a', text: 'Πρώτη' }, { id: 'b', text: 'Δεύτερη' }], timeLimitSeconds: 20, deadline: reveal ? null : ms + 20000 },
    reveal: reveal ? { correct: ['b'], explanation: 'Fixture explanation',
      learning: { title: 'Fixture fact', kicker: 'Fixture kicker', summary: 'Fixture summary',
        whyCorrect: 'Fixture reason', significance: 'Fixture significance', imageAlt: 'Fixture image',
        imageCaption: 'Fixture caption', imageUrl: '/learning-assets/fixture.webp', aiGenerated: true }, answered: 1, eligible: 1 } : null,
    own: submitted ? { submitted: ['b'], correct: reveal, points: reveal ? 73 : 0, elapsedMs: 1200, late: false } : null,
    answered: submitted ? 1 : 0, eligible: 1,
    participants: [{ participantId: PLAYER, kind, userId: PLAYER, nickname: 'Fixture learner', joinedAt: ms - 1000,
      removed: false, eligible: true, answered: submitted }],
    standings: reveal ? [{ participantId: PLAYER, kind, userId: PLAYER, nickname: 'Fixture learner',
      total: 73, correct: 1, elapsedOnCorrectMs: 1200, rank: 1 }] : [],
    me: host ? null : { participantId: PLAYER, kind, userId: mode === 'core' ? PLAYER : null, joinedPhaseVersion: 0, removed: false },
  } };
}

function fixture(t, { mode = 'core', organiser = false, ttl = 43200 } = {}) {
  let now = 1800000000;
  const identity = { mode, organiser, principalId: 'lgu-identity:fixture-stable-person',
    meetingId: 'bbb-INTERNAL-meeting', participantId: 'w_fixture_current',
    corePersonId: mode === 'core' ? '29' : null, coreIssuer: mode === 'core' ? 'fixture-school-core' : null };
  const ownProof = { ...proof, ...(mode === 'guest' ? { coreToken: undefined } : {}) };
  const calls = []; const authCalls = []; const vaults = []; const nonces = new Set();
  let override;
  let authFailure;
  let entered = 0;
  let state = engineView({ mode, host: organiser });
  let commandResult = { phase: 'prepare', phaseVersion: 11 };
  const principal = () => ({ id: PRINCIPAL, role: organiser ? 'moderator' : 'viewer', identityKind: mode,
    displayName: 'Fixture person', canHost: organiser });
  const meeting = () => ({ key: identity.meetingId, name: 'BBB meeting' });
  const launch = () => ({ ticket: TICKET, expiresIn: 120, principal: principal(), meeting: meeting() });
  const activation = () => ({ principal: principal(), meeting: meeting(), session: null });
  const context = () => ({ principal: principal(), meeting: meeting(), issuer: { id: ISSUER, kind: 'bbb4', name: 'Fixture issuer' },
    themes: organiser ? [{ id: TOPIC, title: 'Ιστορία', description: 'Fixture', languages: ['el'], questionCount: 2 }] : null,
    sessions: [{ id: SESSION, topicId: TOPIC, themeTitle: 'Ιστορία', phase: 'lobby', questionIndex: 0,
      questionCount: 2, participants: 1, createdAt: now * 1000, joined: entered > 0, live: true }] });
  const identityService = { async identifySelf(p, body) {
    authCalls.push({ proof: clean(p), body }); assert.deepEqual(p, ownProof); assert.deepEqual(body, {});
    if (authFailure) throw authFailure;
    return { identity: { ...identity }, expiresAt: now + 120 };
  } };
  const client = createFederationClient({ origin: ORIGIN, issuerId: ISSUER, readSecret: () => SECRET, clock: () => now,
    fetchImpl: async (url, options) => {
      const u = new URL(url); const path = u.pathname + u.search; const h = new Headers(options.headers);
      const raw = options.body ?? ''; const data = raw ? JSON.parse(raw) : undefined;
      const call = { url, path, options, headers: h, data, raw }; calls.push(call);
      assert.equal(u.origin, ORIGIN); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
      assert.equal(options.cache, 'no-store'); assert.ok(options.signal instanceof AbortSignal);
      assert.equal(h.has('authorization'), false); assert.doesNotMatch(JSON.stringify(options), /fixture-bbb-proof|fixture-core-proof|bbb_fixture/);
      if (h.has('x-lgu-federation-signature')) {
        assert.equal(h.has('cookie'), false, 'signed transport has no ambient Cookie, even when the vault is populated');
        assert.equal(h.has('origin'), false); assert.equal(h.get('x-lgu-federation-issuer'), ISSUER);
        assert.equal(h.get('x-lgu-federation-timestamp'), String(now));
        const nonce = h.get('x-lgu-federation-nonce'); assert.match(nonce, /^[A-Za-z0-9_-]{16,128}$/);
        assert.equal(nonces.has(nonce), false, 'fresh nonce on EVERY signed request'); nonces.add(nonce);
        assert.equal(h.get('x-lgu-federation-signature'), expectedSignature({ now, nonce, method: options.method, path, body: raw }));
        if (options.method === 'GET') assert.equal(options.body, undefined, 'GET signs the empty byte string');
      } else if (path.startsWith('/media/') || path.startsWith('/api/audio?')) {
        assert.equal(options.method, 'GET'); assert.equal(h.get('origin'), ORIGIN);
        assert.equal(h.has('x-lgu-request'), false);
        assert.ok(h.get('cookie')?.includes(mode === 'core' ? `lgu_session=${ACCOUNT}` : `lgu_live=${LIVE}`));
        assert.equal(h.get('x-lgu-client'), 'web/0.1.0');
      } else {
        assert.equal(h.get('origin'), ORIGIN); assert.equal(h.get('x-lgu-request'), '1');
        assert.equal(h.has('x-lgu-federation-issuer'), false);
      }
      if (override) { const response = await override(call); if (response !== undefined) return response; }
      if (path === PREFIX + 'launch') return json(launch(), [], 201);
      if (path === PREFIX + 'activate') {
        assert.equal(options.method, 'POST'); assert.deepEqual(data, { ticket: TICKET }); assert.equal(h.has('cookie'), false);
        return json(activation(), [cookie('lgu_fed', FED, ttl), ...(mode === 'core' ? [cookie('lgu_session', ACCOUNT, ttl)] : [])]);
      }
      if (u.pathname === PREFIX + 'context') {
        assert.equal(options.method, 'GET'); assert.equal(u.search, `?principalId=${PRINCIPAL}`); return json(context());
      }
      if (path === PREFIX + 'sessions') {
        assert.deepEqual(data, { principalId: PRINCIPAL, topicId: TOPIC });
        return json({ session: { id: SESSION, eventId: FOREIGN, phase: 'lobby', entry: 'closed', joined: false,
          questionCount: 2, participants: 0, createdAt: now * 1000, startedAt: null, finishedAt: null } }, [], 201);
      }
      if (path === PREFIX + `sessions/${SESSION}/enter`) {
        assert.equal(options.method, 'POST'); assert.deepEqual(data, {}); assert.ok(h.get('cookie')?.includes(`lgu_fed=${FED}`));
        assert.equal(h.get('cookie')?.includes('lgu_session='), mode === 'core');
        entered++;
        return json({ sessionId: SESSION, participant: { participantId: PLAYER, kind: mode === 'core' ? 'account' : 'guest',
          displayName: 'Fixture learner' }, created: entered === 1 }, mode === 'guest' ? [cookie('lgu_live', LIVE, ttl)] : [], entered === 1 ? 201 : 200);
      }
      if (path === `/api/v1/live/${SESSION}` || u.pathname === PREFIX + `sessions/${SESSION}`) {
        if (!organiser) assert.ok(h.get('cookie')?.includes(mode === 'core' ? `lgu_session=${ACCOUNT}` : `lgu_live=${LIVE}`));
        return json(state);
      }
      if (path === `/api/v1/live/${SESSION}/answer`) {
        assert.equal(options.method, 'POST'); assert.ok(h.get('cookie')?.includes(mode === 'core' ? `lgu_session=${ACCOUNT}` : `lgu_live=${LIVE}`));
        return json({ accepted: true, elapsedMs: 1200 });
      }
      if (path === PREFIX + `sessions/${SESSION}/command`) return json(commandResult);
      if (u.pathname.endsWith('/stream')) return new Response('event: hello\ndata: {"after":5}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
      assert.fail(`unexpected fixture route: ${path}`);
    } });
  const makeVault = client.vault;
  client.vault = () => { const v = makeVault(); vaults.push(v); return v; };
  const bff = createLiveBff({ identityService, client, pluginCommit: 'fixture-only' });
  t.after(() => bff.dispose());
  return { bff, client, identity, ownProof, calls, authCalls, vaults, launch, activation, context,
    handle: (operation, body = {}, signal) => bff.handle(operation, ownProof, body, signal),
    resource: (path, signal, headers) => bff.handlePlayerResource(path, ownProof, signal, headers),
    advance: seconds => { now += seconds; }, setOverride: fn => { override = fn; },
    setState: value => { state = value; }, setCommandResult: value => { commandResult = value; },
    setAuthFailure: value => { authFailure = value; }, count: suffix => calls.filter(c => new URL(c.url).pathname === PREFIX + suffix).length };
}

test('signatureHeaders covers exact UTF8/body bytes, method, timestamp, nonce and path INCLUDING query', () => {
  const base = { issuerId: ISSUER, secret: SECRET, method: 'post', path: PREFIX + `context?principalId=${PRINCIPAL}&after=7`,
    body: '{ "label": "Άννα", "answer": ["b","a"] }\n', now: 1800000000, nonce: 'fixture_nonce_0123456789' };
  assert.deepEqual(signatureHeaders(base), {
    'X-LGU-Federation-Issuer': ISSUER, 'X-LGU-Federation-Timestamp': String(base.now),
    'X-LGU-Federation-Nonce': base.nonce, 'X-LGU-Federation-Signature': expectedSignature(base) });
  const original = expectedSignature(base);
  for (const altered of [{ issuerId: 'bbb4-other' }, { now: base.now + 1 }, { nonce: base.nonce + 'x' },
    { method: 'GET' }, { path: base.path.replace('after=7', 'after=8') }, { path: PREFIX + 'launch' },
    { body: JSON.stringify(JSON.parse(base.body)) }, { body: base.body + ' ' }]) {
    assert.notEqual(signatureHeaders({ ...base, ...altered })['X-LGU-Federation-Signature'], original);
  }
  assert.equal(signatureHeaders({ ...base, method: 'GET', body: '' })['X-LGU-Federation-Signature'],
    expectedSignature({ ...base, method: 'GET', body: '' }));
});

test('CookieVault accepts only LGU cookies, honors deletion/clock expiry and caps lifetime to 12 hours', () => {
  let now = 100; const vault = new CookieVault(() => now);
  vault.absorb(json({}, [cookie('lgu_fed', FED, 2), cookie('lgu_session', ACCOUNT, 999999), cookie('other', LIVE),
    'lgu_live=bad!; Max-Age=20']).headers);
  assert.equal(vault.header(), `lgu_fed=${FED}; lgu_session=${ACCOUNT}`);
  now += 2; assert.equal(vault.has('lgu_fed'), false); assert.equal(vault.has('lgu_session'), true);
  now = 43300; assert.equal(vault.header(), '');
  vault.absorb(json({}, [cookie('lgu_live', LIVE), 'lgu_live=; Max-Age=0']).headers);
  assert.equal(vault.header(), ''); vault.absorb(json({}, [cookie('lgu_fed', FED)]).headers); vault.clear(); assert.equal(vault.header(), '');
  // Exercise the fallback for implementations without Headers.getSetCookie().
  vault.absorb({ get: () => `${cookie('lgu_fed', FED)}, ${cookie('lgu_live', LIVE)}` });
  assert.equal(vault.header(), `lgu_fed=${FED}; lgu_live=${LIVE}`);
});

test('private resource routes are narrowly allowlisted and proxy media/audio bytes through the server cookie vault', async t => {
  const f = fixture(t, { mode: 'guest' });
  for (const path of [
    '/media/odyssey/stone-001.webp',
    '/api/audio?mode=live&id=22222222-2222-4222-8222-222222222222&lang=el&segment=prompt',
  ]) assert.equal(validPrivateResourcePath(path), true);
  for (const path of ['/media/../secret', '/media/topic/nested/image.webp', '/api/audio?mode=admin&id=x',
    '/api/audio?mode=live&id=22222222-2222-4222-8222-222222222222&lang=el&segment=prompt&url=https://evil.test',
    '/api/audio?mode=live&mode=admin&id=22222222-2222-4222-8222-222222222222&lang=el&segment=prompt']) {
    assert.equal(validPrivateResourcePath(path), false);
  }
  await f.handle('enter', { sessionId: SESSION });
  const mediaPath = '/media/odyssey/stone-001.webp';
  const audioPath = `/api/audio?mode=live&id=${SESSION}&lang=el&segment=prompt`;
  f.setOverride(call => call.path === mediaPath ? new Response(Uint8Array.from([10, 11]), { headers: {
    'Content-Type': 'image/webp', 'Set-Cookie': cookie('lgu_live', LIVE), 'X-Upstream-Secret': SECRET,
  } }) : call.path === audioPath ? new Response(Uint8Array.from([12, 13]), { headers: {
    'Content-Type': 'audio/mpeg', 'Set-Cookie': cookie('lgu_live', LIVE),
  } }) : undefined);
  for (const [path, expectedType, expectedBytes] of [[mediaPath, 'image/webp', [10, 11]], [audioPath, 'audio/mpeg', [12, 13]]]) {
    const response = await f.resource(path, new AbortController().signal, { accept: '*/*', client: 'web/0.1.0' });
    assert.equal(response.headers.get('content-type'), expectedType);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], expectedBytes);
  }
  const resourceCalls = f.calls.filter(call => call.path === mediaPath || call.path === audioPath);
  assert.equal(resourceCalls.length, 2);
  assert.ok(resourceCalls.every(call => call.headers.get('cookie').includes(`lgu_live=${LIVE}`)));
  assert.ok(resourceCalls.every(call => call.options.credentials === 'omit'));
  assert.ok(resourceCalls.every(call => call.headers.has('origin')));
  assert.ok(resourceCalls.every(call => !call.headers.has('x-lgu-federation-signature')));
  assert.doesNotMatch(JSON.stringify(resourceCalls.map(call => call.options.headers)), /fixture-bbb-proof|fixture-core-proof|SSSSSS/);
});

test('safeView recursively redacts credentials, join code/path and pending without mutating engine results', () => {
  const source = { session: { id: SESSION, code: 'PRIVATECODE', joinPath: '/live/join/PRIVATECODE', pending: [{ nickname: 'private' }],
    own: { points: 73 }, nested: [{ TiCkEt: TICKET, token: FED, SECRET, Cookie: FED, Authorization: FED, 'Set-Cookie': FED,
      credential: { token: LIVE }, credentials: { account: ACCOUNT }, signature: SECRET, cookies: [LIVE], keep: 'ok' }] } };
  const before = clean(source);
  assert.deepEqual(safeView(source), { session: { id: SESSION, own: { points: 73 }, nested: [{ keep: 'ok' }] } });
  assert.deepEqual(source, before);
});

for (const mode of ['core', 'guest']) for (const organiser of [true, false]) {
  test(`${mode} ${organiser ? 'moderator' : 'viewer'} launch binds verified internal meeting, stable principal and identity; reconnect launches once`, async t => {
    const f = fixture(t, { mode, organiser });
    const first = await f.handle('context');
    f.identity.participantId = 'w_reconnected_transport';
    await Promise.all([f.handle('context'), f.handle('context')]);
    assert.equal(f.count('launch'), 1); assert.equal(f.count('activate'), 1); assert.equal(f.count('context'), 3);
    assert.equal(f.authCalls.length, 3, 'each request revalidates own proof');
    const launched = f.calls.find(c => c.path === PREFIX + 'launch').data;
    assert.deepEqual(launched, { meeting: { id: 'bbb-INTERNAL-meeting', name: 'BBB meeting' },
      participant: { id: f.identity.principalId, role: organiser ? 'moderator' : 'viewer',
        displayName: organiser ? 'BBB Moderator' : 'BBB Participant',
        identity: mode === 'core' ? { kind: 'core', issuer: 'fixture-school-core', subject: '29' } : { kind: 'guest' } },
      plugin: { name: 'LGU Activities', version, commit: 'fixture-only' } });
    assert.notEqual(launched.participant.id, 'w_fixture_current');
    assert.equal(first.principal.canHost, organiser); assert.equal(first.themes === null, !organiser);
    assert.equal(f.vaults[0].has('lgu_fed'), true); assert.equal(f.vaults[0].has('lgu_session'), mode === 'core');
    assert.doesNotMatch(JSON.stringify(first), /TTTTTT|FFFFFF|AAAAAA|fixture-core-proof|PRIVATECODE/);
  });
}

test('parallel first requests share one launch/activation under the per-principal lock', async t => {
  const f = fixture(t); await Promise.all(Array.from({ length: 8 }, () => f.handle('context')));
  assert.equal(f.count('launch'), 1); assert.equal(f.count('activate'), 1); assert.equal(f.authCalls.length, 8);
});

test('moderator selects only licensed context themes; creation remains closed and strips malicious code fields', async t => {
  const f = fixture(t, { organiser: true });
  const made = await f.handle('create', { topicId: TOPIC }); assert.equal(made.session.entry, 'closed');
  assert.equal(Object.hasOwn(made.session, 'code'), false);
  f.setOverride(c => c.path === PREFIX + 'sessions' ? json({ session: { id: SESSION, entry: 'closed', code: 'PRIVATECODE',
    joinPath: '/live/join/PRIVATECODE', pending: [], ticket: TICKET } }) : undefined);
  assert.deepEqual(await f.handle('create', { topicId: TOPIC }), { session: { id: SESSION, entry: 'closed' } });
  const before = f.count('sessions'); await assert.rejects(f.handle('create', { topicId: 'unlicensed' }), { code: 'THEME_NOT_ALLOWED', status: 403 });
  assert.equal(f.count('sessions'), before);
});

for (const entry of ['open', 'members', null, { live: 'closed' }]) {
  test(`creation rejects LGU entry policy ${JSON.stringify(entry)}`, async t => {
    const f = fixture(t, { organiser: true });
    f.setOverride(c => c.path === PREFIX + 'sessions' ? json({ session: { id: SESSION, entry } }) : undefined);
    await assert.rejects(f.handle('create', { topicId: TOPIC }), { code: 'LGU_ENTRY_NOT_CLOSED', status: 502 });
  });
}

for (const operation of ['create', 'command']) {
  test(`viewer cannot ${operation}, even before launch`, async t => {
    const f = fixture(t, { mode: 'guest' });
    await assert.rejects(f.handle(operation, operation === 'create' ? { topicId: TOPIC }
      : { sessionId: SESSION, action: 'start', expectedVersion: 0 }), { code: 'TEACHER_REQUIRED', status: 403 });
    assert.equal(f.authCalls.length, 1); assert.equal(f.calls.length, 0);
  });
}

for (const mode of ['core', 'guest']) {
  test(`${mode} explicit entry repeats LGU idempotent door, preserves participant; ordinary GET/answer and mock reveal 73 are passed through`, async t => {
    const f = fixture(t, { mode });
    const first = await f.handle('enter', { sessionId: SESSION });
    const again = await f.handle('enter', { sessionId: SESSION });
    assert.equal(first.created, true); assert.equal(again.created, false); assert.equal(first.participant.participantId, PLAYER);
    assert.deepEqual(again.participant, first.participant); assert.equal(f.count(`sessions/${SESSION}/enter`), 2);
    const open = await f.handle('state', { sessionId: SESSION });
    assert.deepEqual(open, safeView(engineView({ mode }))); assert.equal(open.session.reveal, null);
    assert.equal(Object.hasOwn(open.session.question, 'correct'), false);
    const answer = { sessionId: SESSION, questionIndex: 0, phaseVersion: 2, answer: ['b'] };
    assert.deepEqual(await f.handle('answer', answer), { accepted: true, elapsedMs: 1200 });
    const sent = f.calls.find(c => c.path === `/api/v1/live/${SESSION}/answer`);
    assert.deepEqual(sent.data, { questionIndex: 0, phaseVersion: 2, answer: ['b'] });
    assert.equal(sent.headers.has('x-lgu-federation-signature'), false);
    f.setState(engineView({ mode, submitted: true }));
    const waiting = await f.handle('state', { sessionId: SESSION }); assert.equal(waiting.session.own.points, 0); assert.equal(waiting.session.own.correct, false);
    // Explicit response selection, NOT a locally implemented LGU transition or points rule.
    const engineResult = engineView({ mode, phase: 'reveal', submitted: true }); f.setState(engineResult);
    const revealed = await f.handle('state', { sessionId: SESSION }); assert.deepEqual(revealed, safeView(engineResult));
    assert.equal(revealed.session.own.points, 73); assert.equal(revealed.session.standings[0].total, 73);
    assert.deepEqual(revealed.session.reveal.correct, ['b']);
    await f.handle('state', { sessionId: SESSION });
    assert.equal(f.count('launch'), 1); assert.equal(f.count('activate'), 1); assert.equal(f.count(`sessions/${SESSION}/enter`), 2);
    assert.equal(f.authCalls.length, 7);
  });
  test(`${mode} first state auto-enters once, subsequent state/answer/stream never re-enter`, async t => {
    const f = fixture(t, { mode }); await f.handle('state', { sessionId: SESSION });
    await f.handle('answer', { sessionId: SESSION, questionIndex: 0, phaseVersion: 2, answer: ['b'] });
    const response = await f.handle('stream', { sessionId: SESSION, after: 5 }); await response.body.cancel();
    assert.equal(f.count(`sessions/${SESSION}/enter`), 1);
    const stream = f.calls.find(c => c.path.endsWith('/stream?after=5'));
    assert.equal(stream.path, `/api/v1/live/${SESSION}/stream?after=5`); assert.equal(stream.headers.has('x-lgu-federation-signature'), false);
    assert.equal(stream.headers.get('accept'), 'text/event-stream');
  });
}

// Every action is paired with a controlled fixture reply, not a transition simulator.
for (const [action, phase] of [['start', 'prepare'], ['open', 'open'], ['close', 'closed'], ['reveal', 'reveal'],
  ['next', 'prepare'], ['finish', 'finished'], ['cancel', 'cancelled']]) {
  test(`host forwards exact LGU action ${action} and expectedVersion, with signed principal and no Cookie`, async t => {
    const f = fixture(t, { organiser: true }); const expectedVersion = 37;
    f.setCommandResult({ phase, phaseVersion: 38 });
    assert.deepEqual(await f.handle('command', { sessionId: SESSION, action, expectedVersion }), { phase, phaseVersion: 38 });
    const sent = f.calls.find(c => c.path.endsWith('/command'));
    assert.deepEqual(sent.data, { principalId: PRINCIPAL, action, expectedVersion }); assert.equal(sent.headers.has('cookie'), false);
  });
}

test('host state and stream use signed meeting-bound routes including cursor; never enter as a player', async t => {
  const f = fixture(t, { organiser: true }); assert.deepEqual(await f.handle('state', { sessionId: SESSION }), safeView(engineView({ host: true })));
  const response = await f.handle('stream', { sessionId: SESSION, after: 9 }); await response.body.cancel();
  assert.ok(f.calls.some(c => c.path === PREFIX + `sessions/${SESSION}/stream?principalId=${PRINCIPAL}&after=9`));
  assert.equal(f.count(`sessions/${SESSION}/enter`), 0);
  await assert.rejects(f.handle('enter', { sessionId: SESSION }), { code: 'ORGANISER_NOT_PLAYER', status: 409 });
  await assert.rejects(f.handle('answer', { sessionId: SESSION, questionIndex: 0, phaseVersion: 2, answer: ['b'] }), { status: 403 });
});

test('foreign session and browser-selected identity/URL fields are refused before any foreign upstream route', async t => {
  const f = fixture(t);
  for (const body of [{ sessionId: SESSION, principalId: PRINCIPAL }, { sessionId: SESSION, url: 'https://attacker.test' },
    { sessionId: SESSION, role: 'host' }, { sessionId: 'https://attacker.test' }, { sessionId: '../../secrets' }]) {
    await assert.rejects(f.handle('state', body), { code: 'INVALID_BODY', status: 400 });
  }
  await assert.rejects(f.handle('state', { sessionId: FOREIGN }), { code: 'SESSION_NOT_FOUND', status: 404 });
  assert.equal(f.calls.some(c => c.path.includes(`sessions/${FOREIGN}`) || c.path.includes(`/live/${FOREIGN}`)), false);
});

for (const status of [401, 403, 404, 409, 429, 500, 502, 503]) {
  test(`upstream ${status} fails closed with safe error, no retries, and critical-status vault clearing`, async t => {
    const f = fixture(t); await f.handle('state', { sessionId: SESSION });
    const before = f.calls.length;
    f.setOverride(c => c.path.endsWith('/answer') ? json({ error: 'private stack https://private.test SECRET',
      code: 'PRIVATE_UPSTREAM_CODE', ticket: TICKET }, [cookie('lgu_fed', 'Z'.repeat(43))], status) : undefined);
    const mapped = status >= 500 ? 503 : status;
    await assert.rejects(f.handle('answer', { sessionId: SESSION, questionIndex: 0, phaseVersion: 2, answer: ['b'] }), error => {
      assert.ok(error instanceof ContractError); assert.equal(error.status, mapped); assert.equal(error.code, `LGU_${mapped}`);
      assert.equal(error.message, `LGU_${mapped}`); assert.doesNotMatch(JSON.stringify(error), /PRIVATE|TTTT|https:/); return true;
    });
    assert.equal(f.calls.length, before + 2, 'one context check and one answer; no retry or recovery launch');
    assert.equal(f.count('launch'), 1);
    const critical = [401, 403, 404, 503].includes(mapped);
    assert.equal(f.vaults[0].header() === '', critical);
    f.setOverride(undefined); await f.handle('context'); assert.equal(f.count('launch'), critical ? 2 : 1);
  });
}

test('transport exceptions are sanitized, never retried, and clear a populated vault', async t => {
  const f = fixture(t); await f.handle('state', { sessionId: SESSION }); const before = f.calls.length;
  f.setOverride(c => { if (c.path.endsWith('/answer')) throw new Error(`private transport ${SECRET} ${TICKET}`); });
  await assert.rejects(f.handle('answer', { sessionId: SESSION, questionIndex: 0, phaseVersion: 2, answer: ['b'] }),
    { code: 'LGU_UNAVAILABLE', message: 'LGU_UNAVAILABLE', status: 503 });
  assert.equal(f.calls.length, before + 2); assert.equal(f.vaults[0].header(), ''); assert.equal(f.count('launch'), 1);
});

test('clock expiry never forwards expired cookies or automatically retries/relaunches on LGU 401', async t => {
  const f = fixture(t, { mode: 'guest', ttl: 2 }); await f.handle('state', { sessionId: SESSION }); f.advance(2);
  assert.equal(f.vaults[0].header(), ''); const before = f.calls.length;
  f.setOverride(c => c.path === `/api/v1/live/${SESSION}` ? (assert.equal(c.headers.has('cookie'), false), json({}, [], 401)) : undefined);
  await assert.rejects(f.handle('state', { sessionId: SESSION }), { code: 'LGU_401', status: 401 });
  assert.equal(f.calls.length, before + 2); assert.equal(f.count('launch'), 1); assert.equal(f.count(`sessions/${SESSION}/enter`), 1);
});

test('12-hour record expiry permits a new explicit request to launch but retains no old credentials', async t => {
  const f = fixture(t); await f.handle('context'); f.advance(43200); await f.handle('context');
  assert.equal(f.count('launch'), 2); assert.equal(f.vaults[0].header(), ''); assert.ok(f.vaults[1].has('lgu_fed'));
});

test('failed fresh proof after record expiry/relaunch clears the renewed vault too', async t => {
  const f = fixture(t); await f.handle('context'); f.advance(43200); await f.handle('context');
  f.setAuthFailure(new ContractError('PROOF_INVALID', 401));
  await assert.rejects(f.handle('context'), { code: 'PROOF_INVALID', status: 401 });
  assert.ok(f.vaults.every(v => v.header() === ''));
});

test('identity fingerprint change clears old vault and refuses reuse of its launch', async t => {
  const f = fixture(t); await f.handle('context'); f.identity.corePersonId = '31';
  await assert.rejects(f.handle('context'), { code: 'FEDERATION_IDENTITY_CHANGED', status: 409 });
  assert.equal(f.vaults[0].header(), ''); assert.equal(f.count('launch'), 1);
});

test('failed fresh authentication clears previously held LGU credentials without upstream work', async t => {
  const f = fixture(t); await f.handle('context'); const before = f.calls.length;
  f.setAuthFailure(new ContractError('PROOF_INVALID', 401));
  await assert.rejects(f.handle('context'), { code: 'PROOF_INVALID', status: 401 });
  assert.equal(f.calls.length, before); assert.equal(f.vaults[0].header(), '', 'critical authentication failure must invalidate its cached vault');
});

for (const [label, change] of [
  ['ticket not 43 characters', r => { r.ticket = 'short'; }], ['wrong expiry', r => { r.expiresIn = 121; }],
  ['non-UUID principal', r => { r.principal.id = 'principal'; }], ['wrong role', r => { r.principal.role = 'moderator'; }],
  ['wrong identity kind', r => { r.principal.identityKind = 'guest'; }], ['wrong host authority', r => { r.principal.canHost = true; }],
  ['external rather than internal meeting', r => { r.meeting.key = 'external-lesson'; }],
]) {
  test(`malformed launch: ${label} prevents activation`, async t => {
    const f = fixture(t); const value = f.launch(); change(value);
    f.setOverride(c => c.path === PREFIX + 'launch' ? json(value) : undefined);
    await assert.rejects(f.handle('context'), { code: 'LGU_INVALID_RESPONSE', status: 502 }); assert.equal(f.count('activate'), 0);
  });
}

for (const [label, mode, cookies] of [
  ['no federation cookie', 'core', [cookie('lgu_session', ACCOUNT)]],
  ['no account cookie', 'core', [cookie('lgu_fed', FED)]],
  ['guest unexpectedly receives an account', 'guest', [cookie('lgu_fed', FED), cookie('lgu_session', ACCOUNT)]],
  ['malformed federation token', 'guest', ['lgu_fed=bad!; Max-Age=43200']],
  ['short federation token', 'guest', [cookie('lgu_fed', 'short')]],
]) {
  test(`activation fails closed: ${label}`, async t => {
    const f = fixture(t, { mode }); f.setOverride(c => c.path === PREFIX + 'activate' ? json(f.activation(), cookies) : undefined);
    await assert.rejects(f.handle('context'), { code: 'LGU_INVALID_RESPONSE', status: 502 });
    assert.equal(f.count('context'), 0); assert.equal(f.vaults[0].header(), '');
  });
}

test('guest entry requires lgu_live cookie and rejects mismatched participant kind/session', async t => {
  for (const value of [
    { sessionId: SESSION, participant: { participantId: PLAYER, kind: 'guest' }, created: true },
    { sessionId: FOREIGN, participant: { participantId: PLAYER, kind: 'guest' }, created: true },
    { sessionId: SESSION, participant: { participantId: PLAYER, kind: 'account' }, created: true },
  ]) {
    const f = fixture(t, { mode: 'guest' }); f.setOverride(c => c.path.endsWith('/enter') ? json(value) : undefined);
    await assert.rejects(f.handle('enter', { sessionId: SESSION }), { code: 'LGU_INVALID_RESPONSE', status: 502 });
  }
});

test('activation cannot alter the signed launch role, identity kind or host authority', async t => {
  for (const change of [r => { r.principal.role = 'moderator'; }, r => { r.principal.identityKind = 'guest'; },
    r => { r.principal.canHost = true; }]) {
    const f = fixture(t); const value = f.activation(); change(value);
    f.setOverride(c => c.path === PREFIX + 'activate' ? json(value, [cookie('lgu_fed', FED), cookie('lgu_session', ACCOUNT)]) : undefined);
    await assert.rejects(f.handle('context'), { code: 'LGU_INVALID_RESPONSE', status: 502 });
    assert.equal(f.vaults[0].header(), '');
  }
});

test('malformed context bindings and state envelope fail closed', async t => {
  for (const mutate of [r => { r.principal.id = FOREIGN; }, r => { r.meeting.key = 'wrong'; },
    r => { r.themes = []; }, r => { r.sessions = {}; }]) {
    const f = fixture(t); const value = f.context(); mutate(value);
    f.setOverride(c => new URL(c.url).pathname === PREFIX + 'context' ? json(value) : undefined);
    await assert.rejects(f.handle('context'), { code: 'LGU_INVALID_RESPONSE', status: 502 });
  }
  for (const mutate of [r => { r.session.id = FOREIGN; }, r => { r.session.role = 'host'; }, r => { r.session.entry = 'open'; }]) {
    const f = fixture(t); const value = engineView(); mutate(value); f.setState(value);
    await assert.rejects(f.handle('state', { sessionId: SESSION }), { code: 'LGU_INVALID_RESPONSE', status: 502 });
  }
});

test('malformed open-question engine shape is refused rather than sent to the browser', async t => {
  const f = fixture(t); const value = engineView(); value.session.question = null; f.setState(value);
  await assert.rejects(f.handle('state', { sessionId: SESSION }), { code: 'LGU_INVALID_RESPONSE', status: 502 });
});

test('client refuses invalid JSON/content type/oversized/non-object responses with safe errors', async t => {
  const f = fixture(t);
  for (const factory of [() => new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
    () => new Response('{}', { headers: { 'Content-Type': 'text/html' } }), () => json([]), () => json(null),
    () => json({ padding: 'x'.repeat(1048576) })]) {
    f.setOverride(factory); await assert.rejects(f.client.request('GET', PREFIX + 'context', undefined, { signed: true }),
      { code: 'LGU_INVALID_RESPONSE', status: 502 });
  }
});

test('client fixed upstream origin/path policy blocks arbitrary URLs, traversal, fragments and injection before fetch', async t => {
  const f = fixture(t);
  for (const path of ['https://evil.test/api/v1/live/' + SESSION, '//evil.test/x', '/api/v1/admin/users',
    PREFIX + '../admin', PREFIX + 'context#fragment', PREFIX + 'context\\x', PREFIX + 'context\r\nCookie: x',
    '/api/v1/live/not-uuid', `/api/v1/live/${SESSION}/answer?url=https://evil.test`]) {
    await assert.rejects(f.client.request('GET', path, undefined, { signed: true }), { code: 'FEDERATION_PATH_DENIED', status: 400 });
  }
  assert.equal(f.calls.length, 0);
  for (const origin of ['http://lgu.fixture.test', ORIGIN + '/', ORIGIN + '/api', 'https://user:pass@lgu.fixture.test', 'https://evil.test?x=1']) {
    assert.throws(() => createFederationClient({ origin, issuerId: ISSUER, readSecret: () => SECRET }));
  }
});

test('invalid mutations are never forwarded and dispose clears all cookies', async t => {
  const f = fixture(t);
  for (const body of [{ sessionId: SESSION, questionIndex: -1, phaseVersion: 2, answer: ['a'] },
    { sessionId: SESSION, questionIndex: 0, phaseVersion: 2, answer: { optionId: 'a' } },
    { sessionId: SESSION, questionIndex: 0, phaseVersion: 2, answer: [3] },
    { sessionId: SESSION, questionIndex: 0, phaseVersion: 2, answer: ['a'], points: 999 }]) {
    await assert.rejects(f.handle('answer', body), { code: 'INVALID_BODY', status: 400 });
  }
  assert.equal(f.calls.some(c => c.path.endsWith('/answer')), false); f.bff.dispose();
  assert.ok(f.vaults.every(v => v.header() === ''));
});