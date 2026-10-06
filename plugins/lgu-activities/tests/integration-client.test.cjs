const test = require('node:test');
const assert = require('node:assert/strict');
const { extractCoreToken, metadataState, mapObservedParticipants, createActivityClient } = require('../src/integration-client');

test('self metadata token extraction rejects duplicates, loading, errors and malformed values', () => {
  const row = { parameter: 'schoolcore_context_token', value: 'fixture-core-self' };
  assert.equal(extractCoreToken({ data: { data: { user_metadata: [row] } } }), row.value);
  for (const result of [undefined, { loading: true }, { error: {} },
    { data: { user_metadata: [row, row] } }, { data: { user_metadata: [{ ...row, value: {} }] } }]) {
    assert.equal(extractCoreToken(result), null);
  }
});

test('same display name is irrelevant; roster IDs exact; guest, duplicate ID and disconnected fail closed', () => {
  const active = { joined: true, currentlyInMeeting: true, name: 'Same Name' };
  const roster = { students: [{ personId: '29' }, { personId: '31' }] };
  const rows = [{ ...active, userId: 'a', extId: '29' }, { ...active, userId: 'b', extId: '31' },
    { ...active, userId: 'guest', extId: '' }, { ...active, userId: 'fake', extId: 'unknown' },
    { ...active, userId: 'old', extId: '31', disconnected: true }];
  const result = mapObservedParticipants(roster, rows, 'teacher');
  assert.deepEqual(result.map((p) => p.personId), ['29', '31', null, null]);
  assert.equal(result[2].status, 'temporary-unverified');
  assert.equal(mapObservedParticipants(roster, [...rows, { ...active, userId: 'dup', extId: '29' }], 'teacher')[0].personId, null);
});

test('client sends two proofs only in headers, fixed same-origin routes and minimal bodies', async () => {
  const requests = [];
  const client = createActivityClient({ sessionToken: 'fixture-bbb-self', coreToken: 'fixture-core-self',
    async fetchImpl(url, options) {
      requests.push({ url, options });
      return Response.json(url.endsWith('/contexts') ? { identityToken: 'fixture-activity-token',
        context: { id: 'context-1', activityId: 'activity-1', lguSessionId: null },
        identity: { role: 'teacher' }, expiresAt: Math.floor(Date.now() / 1000) + 120 } : {});
    } });
  await client.identify();
  const prepared = await client.prepare('activity-1');
  assert.equal(prepared.identityToken, undefined);
  await client.verifyPreparedIdentity();
  assert.deepEqual(requests.map((r) => JSON.parse(r.options.body)), [{}, { activityId: 'activity-1' },
    { contextId: 'context-1', identityToken: 'fixture-activity-token' }]);
  for (const request of requests) {
    assert.match(request.url, /^\/api\/lgu-activities\/v1\//);
    assert.doesNotMatch(request.url, /fixture-/);
    assert.equal(request.options.credentials, 'same-origin');
    assert.equal(request.options.redirect, 'error');
    assert.equal(request.options.cache, 'no-store');
    assert.equal(request.options.headers.Authorization, 'Bearer fixture-core-self');
    assert.equal(request.options.headers['X-BBB-Session-Token'], 'fixture-bbb-self');
  }
  client.dispose();
  assert.equal(requests[0].options.signal.aborted, true);
  await assert.rejects(client.identify(), /PROOF_REQUIRED/);
});

test('denied or malformed context response never becomes a prepared activity', async () => {
  for (const response of [Response.json({ error: 'denied' }, { status: 403 }),
    Response.json({ context: { id: 'fake', activityId: 'other' } })]) {
    const client = createActivityClient({ sessionToken: 'fixture-bbb', coreToken: 'fixture-core', fetchImpl: async () => response });
    await assert.rejects(client.prepare('activity-1'));
    client.dispose();
  }
});

test('metadataState distinguishes valid absence from invalid token rows and unavailable metadata', () => {
  assert.equal(metadataState({ loading: false, data: { user_metadata: [] } }), 'absent');
  assert.equal(metadataState({ loading: false, data: { data: { user_metadata: [{ parameter: 'unrelated', value: 'x' }] } } }), 'absent');
  const token = { parameter: 'schoolcore_context_token', value: 'fixture-core' };
  assert.equal(metadataState({ data: { user_metadata: [token] } }), 'present');
  for (const value of ['', ' ', null, {}, 123]) {
    assert.equal(metadataState({ data: { user_metadata: [{ ...token, value }] } }), 'invalid');
  }
  assert.equal(metadataState({ data: { user_metadata: [token, token] } }), 'invalid');
  assert.equal(metadataState({ data: {} }), 'invalid');
  assert.equal(metadataState({ error: {} }), 'invalid');
  assert.equal(metadataState(undefined), 'loading');
  assert.equal(metadataState({ data: { loading: true, user_metadata: [] } }), 'loading');
});

test('guest client sends only BBB proof headers and minimal identity/context bodies', async () => {
  const requests = [];
  const client = createActivityClient({ sessionToken: 'fixture-bbb-guest', fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return Response.json(url.endsWith('/contexts') ? { identityToken: 'private-guest-token',
      context: { id: 'guest-context', activityId: 'approved-activity', lguSessionId: null },
      identity: { mode: 'guest', organiser: true }, expiresAt: Math.floor(Date.now() / 1000) + 120 } : {});
  } });
  await client.identify();
  const prepared = await client.prepare('approved-activity');
  assert.equal(prepared.identityToken, undefined);
  assert.deepEqual(requests.map(r => JSON.parse(r.options.body)), [{}, { activityId: 'approved-activity' }]);
  for (const { options } of requests) {
    assert.equal(Object.hasOwn(options.headers, 'Authorization'), false);
    assert.equal(options.headers['X-BBB-Session-Token'], 'fixture-bbb-guest');
    assert.equal(options.credentials, 'same-origin');
  }
  client.dispose();
});