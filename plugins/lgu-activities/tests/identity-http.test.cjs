const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createIdentityHttpHandler } = require('../server/http-handler.cjs');
const { createIdentityFixture } = require('./fixtures/identity-fixture.cjs');

async function harness(t) {
  const fixture = await createIdentityFixture();
  let handler;
  const server = http.createServer((request, response) => handler(request, response));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  handler = createIdentityHttpHandler({ service: fixture.service, origin, allowLoopback: true });
  async function post(route, body, proof = fixture.proofs.teacher, overrides = {}) {
    return fetch(`${origin}/api/lgu-activities/v1/${route}`, { method: 'POST', redirect: 'error',
      headers: { Origin: origin, 'Content-Type': 'application/json',
        ...(proof.coreToken !== undefined ? { Authorization: `Bearer ${proof.coreToken}` } : {}),
        'X-BBB-Session-Token': proof.sessionToken, Cookie: proof.cookie, ...overrides }, body: JSON.stringify(body) });
  }
  return { origin, fixture, post };
}

test('HTTP teacher context + student self exchange + cross-student rejection use real handler', async (t) => {
  const h = await harness(t);
  const response = await h.post('contexts', { activityId: 'fixture-live-one' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const ctx = await response.json();
  const a = await (await h.post('identities', { contextId: ctx.context.id }, h.fixture.proofs.studentA)).json();
  assert.equal(a.identity.corePersonId, '29');
  assert.equal(a.context.students, undefined);
  assert.equal(a.context.teacher, undefined);
  const denied = await h.post('verify', { contextId: ctx.context.id, identityToken: a.identityToken }, h.fixture.proofs.studentB);
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: 'ACTIVITY_BINDING_MISMATCH' });
});

test('HTTP boundary rejects cross-origin, non-JSON, spoofed fields, invalid cookie and oversized body', async (t) => {
  const h = await harness(t);
  assert.equal((await h.post('identity', {}, undefined, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await h.post('identity', {}, undefined, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await h.post('identity', { personId: '29', role: 'teacher' })).status, 400);
  const denied = await h.post('identity', {}, undefined, { Cookie: 'wrong-cookie=1' });
  assert.equal(denied.status, 401);
  assert.equal(JSON.stringify(await denied.json()).includes('fixture-core'), false);
  assert.equal((await h.post('identity', { padding: 'x'.repeat(16385) })).status, 413);
});

test('HTTP handler has no GET/CORS fallback and requires trusted HTTPS origin outside fixtures', async (t) => {
  const h = await harness(t);
  assert.equal((await fetch(`${h.origin}/api/lgu-activities/v1/identity`)).status, 405);
  assert.equal((await fetch(`${h.origin}/api/lgu-activities/v1/arbitrary`)).status, 404);
  assert.throws(() => createIdentityHttpHandler({ service: h.fixture.service, origin: h.origin }));
});

test('self identity is caller-only for student, has no roster/token and rejects browser identity fields', async (t) => {
  const h = await harness(t);
  const response = await h.post('self', {}, h.fixture.proofs.studentA);
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.identity.personId, '29');
  assert.equal(body.identity.role, 'student'); assert.equal(body.classroom, undefined);
  assert.equal(body.identity.mode, 'core'); assert.equal(body.identity.organiser, false);
  assert.equal(body.identity.persistentHistoryEligible, true);
  assert.equal(body.identityToken, undefined);
  assert.equal((await h.post('self', { role: 'teacher' }, h.fixture.proofs.studentA)).status, 400);
});

test('HTTP guest moderator and viewer use BBB-only proofs, nullable Core IDs and minimal bodies', async (t) => {
  const h = await harness(t);
  const organiser = h.fixture.proofs.guestModerator;
  const identified = await h.post('identity', {}, organiser);
  assert.equal(identified.status, 200);
  const own = await identified.json();
  assert.equal(own.identity.mode, 'guest');
  assert.equal(own.identity.personId, null);
  assert.equal(own.identity.organiser, true);
  assert.equal(own.identity.persistentHistoryEligible, false);
  assert.equal(own.classroom, null);
  const response = await h.post('contexts', { activityId: 'fixture-live-one' }, organiser);
  assert.equal(response.status, 200);
  const ctx = await response.json();
  const viewer = h.fixture.proofs.guest;
  const self = await h.post('self', {}, viewer);
  assert.equal(self.status, 200);
  const selfBody = await self.json();
  assert.equal(selfBody.identity.organiser, false);
  assert.equal(selfBody.classroom, undefined);
  const forbidden = await h.post('identity', {}, viewer);
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { error: 'TEACHER_REQUIRED' });
  const preparedDenied = await h.post('contexts', { activityId: 'fixture-live-one' }, viewer);
  assert.equal(preparedDenied.status, 403);
  assert.deepEqual(await preparedDenied.json(), { error: 'TEACHER_REQUIRED' });
  const issued = await h.post('identities', { contextId: ctx.context.id }, viewer);
  assert.equal(issued.status, 200);
  const identity = await issued.json();
  assert.equal(identity.identity.corePersonId, null);
  assert.equal(identity.identity.coreIssuer, null);
  assert.equal(identity.identity.scope, 'activity:participate');
  const verified = await h.post('verify', { contextId: ctx.context.id, identityToken: identity.identityToken }, viewer);
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).identity.principalId, selfBody.identity.principalId);
  assert.equal(h.fixture.calls.core.length, 0);
  assert.equal(h.fixture.calls.classroom.length, 0);
});

test('HTTP supplied malformed/invalid Core headers never fall back to guest', async (t) => {
  const h = await harness(t);
  const proof = { ...h.fixture.proofs.teacher, coreToken: undefined };
  for (const Authorization of ['', 'Basic synthetic', 'Bearer', 'Bearer one two', 'Bearer unknown']) {
    const response = await h.post('identity', {}, proof, { Authorization });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'CORE_PROOF_INVALID' });
  }
  assert.equal((await h.post('identity', {}, proof)).status, 200);
  const invalidBbb = await h.post('identity', {}, { ...proof, sessionToken: 'unknown' });
  assert.equal(invalidBbb.status, 401);
  assert.deepEqual(await invalidBbb.json(), { error: 'PROOF_INVALID' });
});