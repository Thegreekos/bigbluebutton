// SYNTHETIC ONLY: real identity service/BFF/transport, fake LGU. NOT a scoring
// engine, database or BBB meeting. Commands select explicitly designed canned
// responses; ['a'] and 73 points are fixed mock engine output, never calculated.
// No environment variables, filesystem credentials or real network are read.
const assert = require('node:assert/strict');
const { createHash, createHmac, randomBytes } = require('node:crypto');
const { createIdentityFixture } = require('./identity-fixture.cjs');
const { createFederationClient, PREFIX } = require('../../server/federation-client.cjs');
const { createLiveBff } = require('../../server/live-bff.cjs');
const SESSION = '22222222-2222-4222-8222-222222222222';
const PLAYER = '33333333-3333-4333-8333-333333333333';
const TOPIC = 'theme-published-sample';
const ORIGIN = 'https://lgu.browser-fixture.test';
const ISSUER = 'bbb4-browser-fixture';
const token = () => randomBytes(32).toString('base64url');
const cookie = (name, value) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=43200`;
const json = (value, cookies = [], status = 200) => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(JSON.stringify(value), { status, headers });
};

async function createLiveBrowserFixture() {
  const identityFixture = await createIdentityFixture();
  const secret = token(); // independent of all proofs, tickets and cookies
  const teacher = { host: true, id: '11111111-1111-4111-8111-111111111111', kind: 'core',
    ticket: token(), fed: token(), account: token() };
  const guest = { host: false, id: '44444444-4444-4444-8444-444444444444', kind: 'guest',
    ticket: token(), fed: token(), live: token() };
  const actors = [teacher, guest];
  const calls = []; const authCalls = []; const failures = []; const nonces = new Set();
  const lastBoundCall = new Map();
  let created = false; let entered = false; let submitted = false;
  let phase = 'lobby'; let phaseVersion = 0; let stale = false;
  const principal = actor => ({ id: actor.id, role: actor.host ? 'moderator' : 'viewer',
    identityKind: actor.kind, displayName: actor.host ? 'Fixture host' : 'Fixture learner', canHost: actor.host });
  const meeting = { key: 'fixture-internal-meeting', name: 'Fixture BBB meeting' };
  const summary = () => ({ id: SESSION, topicId: TOPIC, themeTitle: 'Published sample', phase,
    questionIndex: 0, questionCount: 1, participants: entered ? 1 : 0, createdAt: identityFixture.time * 1000,
    entry: 'closed', startedAt: null, finishedAt: null, live: true });
  function state(actor) {
    const reveal = phase === 'reveal'; const ms = identityFixture.time * 1000;
    return { session: { ...summary(), eventId: '55555555-5555-4555-8555-555555555555',
      eventTitle: 'Fixture meeting', language: 'el', phaseVersion, lastSeq: phaseVersion,
      role: actor.host ? 'host' : 'participant', hostNickname: 'Fixture host',
      openedAt: phase === 'open' ? ms : null, deadline: phase === 'open' ? ms + 20000 : null,
      serverTime: ms, settings: { basePoints: 100, speedBonus: 50, graceMs: 300, bucketMs: 250 },
      code: 'PRIVATE_JOIN_CODE', joinPath: '/live/join/PRIVATE_JOIN_CODE', pending: [], eventAccess: actor.host,
      question: phase === 'lobby' ? null : { index: 0, total: 1, id: 'fixture-question', kind: 'choice',
        prompt: 'Choose the fixture answer', options: [{ id: 'a', text: 'First fixture option' },
          { id: 'b', text: 'Second fixture option' }], timeLimitSeconds: 20,
        deadline: phase === 'open' ? ms + 20000 : null },
      reveal: reveal ? { correct: ['a'], explanation: 'Canned mock LGU explanation', answered: 1, eligible: 1 } : null,
      own: !actor.host && submitted ? { submitted: ['a'], correct: reveal, points: reveal ? 73 : 0,
        elapsedMs: 1200, late: false } : null,
      answered: submitted ? 1 : 0, eligible: entered ? 1 : 0,
      participants: entered ? [{ participantId: PLAYER, kind: 'guest', userId: null,
        nickname: 'Fixture learner', joinedAt: ms, removed: false, eligible: true, answered: submitted }] : [],
      standings: reveal ? [{ participantId: PLAYER, kind: 'guest', userId: null,
        nickname: 'Fixture learner', total: 73, correct: 1, elapsedOnCorrectMs: 1200, rank: 1 }] : [],
      me: actor.host ? null : { participantId: PLAYER, kind: 'guest', userId: null,
        joinedPhaseVersion: 0, removed: false } } };
  }
  const identityService = { async identifySelf(proof, body) {
    try {
      assert.deepEqual(body, {});
      const name = proof.sessionToken === identityFixture.proofs.teacher.sessionToken ? 'teacher' : 'guest';
      const expected = identityFixture.proofs[name];
      assert.equal(proof.sessionToken, expected.sessionToken);
      assert.equal(proof.coreToken ?? undefined, expected.coreToken);
      assert.equal(proof.cookie, expected.cookie);
      // Real service checks self proofs against authoritative SYNTHETIC BBB/Core
      // registries; no request-body identity or browser role grants authority.
      const result = await identityFixture.service.identifySelf(proof, body);
      assert.equal(result.identity.organiser, name === 'teacher');
      assert.equal(result.identity.mode, name === 'teacher' ? 'core' : 'guest');
      authCalls.push(name); return result;
    } catch (error) { failures.push(error.message); throw error; }
  } };
  const client = createFederationClient({ origin: ORIGIN, issuerId: ISSUER,
    readSecret: () => secret, clock: () => identityFixture.time,
    fetchImpl: async (url, options) => {
      try {
        const u = new URL(url); const path = u.pathname + u.search;
        const h = new Headers(options.headers); const raw = options.body ?? '';
        const data = raw ? JSON.parse(raw) : undefined;
        assert.equal(u.origin, ORIGIN); assert.equal(options.redirect, 'error');
        assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
        assert.ok(options.signal instanceof AbortSignal); assert.equal(h.has('authorization'), false);
        assert.doesNotMatch(JSON.stringify(options), /fixture-bbb-|fixture-core-|fixture-bbb-session/);
        const signed = h.has('x-lgu-federation-signature');
        if (signed) {
          assert.equal(h.has('cookie'), false); assert.equal(h.has('origin'), false);
          assert.equal(h.get('x-lgu-federation-issuer'), ISSUER);
          assert.equal(h.get('x-lgu-federation-timestamp'), String(identityFixture.time));
          const nonce = h.get('x-lgu-federation-nonce');
          assert.match(nonce, /^[A-Za-z0-9_-]{16,128}$/); assert.equal(nonces.has(nonce), false); nonces.add(nonce);
          // Independent oracle covers exact method, query and UTF-8 body bytes.
          const payload = ['LGU-FEDERATION-V1', ISSUER, String(identityFixture.time), nonce,
            options.method.toUpperCase(), path, createHash('sha256').update(raw).digest('hex')].join('\n');
          assert.equal(h.get('x-lgu-federation-signature'), createHmac('sha256', secret).update(payload).digest('hex'));
          if (options.method === 'GET') assert.equal(options.body, undefined);
        } else {
          assert.equal(h.get('origin'), ORIGIN); assert.equal(h.get('x-lgu-request'), '1');
          assert.equal(h.has('x-lgu-federation-issuer'), false);
        }
        calls.push({ path, method: options.method, data, signed });
        if (path === PREFIX + 'launch') {
          assert.equal(signed, true); assert.equal(options.method, 'POST');
          assert.deepEqual(data.meeting, { id: meeting.key, name: 'BBB meeting' });
          const actor = data.participant.role === 'moderator' ? teacher : guest;
          assert.deepEqual(data.participant.identity, actor.host
            ? { kind: 'core', issuer: 'fixture-school-core', subject: '17' } : { kind: 'guest' });
          assert.match(data.participant.id, /^lgu-identity:/);
          return json({ ticket: actor.ticket, expiresIn: 120, principal: principal(actor), meeting }, [], 201);
        }
        if (path === PREFIX + 'activate') {
          assert.equal(signed, false); assert.equal(options.method, 'POST'); assert.equal(h.has('cookie'), false);
          const actor = actors.find(a => a.ticket === data.ticket); assert.ok(actor);
          assert.deepEqual(data, { ticket: actor.ticket });
          return json({ principal: principal(actor), meeting, session: null },
            [cookie('lgu_fed', actor.fed), ...(actor.host ? [cookie('lgu_session', actor.account)] : [])]);
        }
        const actor = signed ? actors.find(a => a.id === (data?.principalId ?? u.searchParams.get('principalId')))
          : actors.find(a => h.get('cookie')?.includes(`lgu_fed=${a.fed}`));
        assert.ok(actor, 'every upstream route has a fixture-bound principal');
        const previous = lastBoundCall.get(actor.id);
        lastBoundCall.set(actor.id, path);
        if (u.pathname === PREFIX + 'context') {
          assert.equal(signed, true); assert.equal(options.method, 'GET');
          assert.equal(u.search, `?principalId=${actor.id}`);
          return json({ principal: principal(actor), meeting, issuer: { id: ISSUER, kind: 'bbb4', name: 'Mock issuer' },
            themes: actor.host ? [{ id: TOPIC, title: 'Published sample', description: 'Canned fixture',
              languages: ['el'], questionCount: 1 }] : null,
            sessions: created ? [{ ...summary(), joined: !actor.host && entered }] : [] });
        }
        const autoEnter = previous === PREFIX + `sessions/${SESSION}/enter`;
        assert.ok(previous === PREFIX + `context?principalId=${actor.id}` || autoEnter,
          'fresh meeting-bound context precedes each session operation');
        if (path === PREFIX + 'sessions') {
          assert.equal(signed, true); assert.equal(actor, teacher); assert.equal(options.method, 'POST');
          assert.deepEqual(data, { principalId: teacher.id, topicId: TOPIC });
          assert.equal(created, false); created = true;
          return json({ session: { ...summary(), joined: false } }, [], 201);
        }
        assert.equal(created, true);
        if (path === PREFIX + `sessions/${SESSION}/enter`) {
          assert.equal(signed, false); assert.equal(actor, guest); assert.equal(options.method, 'POST');
          assert.deepEqual(data, {});
          assert.equal(h.get('cookie'), `lgu_fed=${guest.fed}${entered ? `; lgu_live=${guest.live}` : ''}`);
          const first = !entered; entered = true;
          return json({ sessionId: SESSION, participant: { participantId: PLAYER, kind: 'guest',
            displayName: 'Fixture learner' }, created: first }, [cookie('lgu_live', guest.live)], first ? 201 : 200);
        }
        if (!signed) {
          assert.equal(actor, guest); assert.equal(h.get('cookie'), `lgu_fed=${guest.fed}; lgu_live=${guest.live}`);
        }
        if (path === PREFIX + `sessions/${SESSION}/command`) {
          assert.equal(signed, true); assert.equal(actor, teacher); assert.equal(options.method, 'POST');
          if (stale) { stale = false; return json({ error: 'PRIVATE_UPSTREAM_STACK', ticket: teacher.ticket, secret }, [], 409); }
          const scripted = { start: ['lobby', 0, 'prepare', 1], open: ['prepare', 1, 'open', 2],
            close: ['open', 2, 'closed', 3], reveal: ['closed', 3, 'reveal', 4] }[data.action];
          assert.ok(scripted, 'only explicitly designed canned transitions exist');
          assert.deepEqual([phase, phaseVersion], scripted.slice(0, 2));
          assert.deepEqual(data, { principalId: teacher.id, action: data.action, expectedVersion: phaseVersion });
          [phase, phaseVersion] = scripted.slice(2); return json({ phase, phaseVersion });
        }
        if (path === `/api/v1/live/${SESSION}/answer`) {
          assert.equal(signed, false); assert.equal(options.method, 'POST');
          assert.equal(phase, 'open'); assert.equal(submitted, false);
          assert.deepEqual(data, { questionIndex: 0, phaseVersion: 2, answer: ['a'] });
          submitted = true; return json({ accepted: true, elapsedMs: 1200 });
        }
        if (u.pathname.endsWith('/stream')) {
          assert.equal(options.method, 'GET'); assert.equal(h.get('accept'), 'text/event-stream');
          assert.match(u.searchParams.get('after'), /^\d+$/);
          assert.equal(u.pathname, actor.host ? PREFIX + `sessions/${SESSION}/stream` : `/api/v1/live/${SESSION}/stream`);
          // Bounded hello + EOF: no long-lived timers or engine simulation.
          return new Response(`event: hello\ndata: {"seq":${phaseVersion},"ticket":"${guest.ticket}"}\n\n`,
            { headers: { 'Content-Type': 'text/event-stream', 'Set-Cookie': cookie('lgu_live', guest.live) } });
        }
        assert.equal(options.method, 'GET');
        assert.equal(u.pathname, actor.host ? PREFIX + `sessions/${SESSION}` : `/api/v1/live/${SESSION}`);
        assert.equal(signed, actor.host); return json(state(actor));
      } catch (error) { failures.push(error.message); throw error; }
    } });
  const bff = createLiveBff({ identityService, client, pluginCommit: 'synthetic-browser-fixture' });
  return { bff, identityService, calls, authCalls, failures, SESSION, TOPIC,
    forbidden: [secret, ...actors.flatMap(a => [a.ticket, a.fed, a.account, a.live].filter(Boolean)),
      'fixture-core-teacher', 'fixture-bbb-teacher', 'fixture-bbb-guest', 'PRIVATE_JOIN_CODE', 'PRIVATE_UPSTREAM_STACK'],
    staleNextCommand() { stale = true; },
    counts() { return { upstream: calls.length, verifiedSelf: authCalls.length, signed: nonces.size,
      launches: calls.filter(c => c.path === PREFIX + 'launch').length,
      activations: calls.filter(c => c.path === PREFIX + 'activate').length,
      entries: calls.filter(c => c.path.endsWith('/enter')).length,
      answers: calls.filter(c => c.path.endsWith('/answer')).length,
      commands: calls.filter(c => c.path.endsWith('/command')).length,
      streams: calls.filter(c => new URL(c.path, ORIGIN).pathname.endsWith('/stream')).length }; } };
}
module.exports = { createLiveBrowserFixture };