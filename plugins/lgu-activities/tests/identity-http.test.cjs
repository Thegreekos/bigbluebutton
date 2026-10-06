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
      headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${proof.coreToken}`,
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