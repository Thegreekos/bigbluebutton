const test = require('node:test');
const assert = require('node:assert/strict');
const { createBbbProofVerifier, createClassroomReader } = require('../server/providers.cjs');

test('BBB proof uses real auth hook response headers and forwards cookies only to fixed hook', async () => {
  let request;
  const verify = createBbbProofVerifier({ hookUrl: 'http://127.0.0.1:8090/bigbluebutton/connection/checkGraphqlAuthorization',
    async fetchImpl(url, options) {
      request = { url, options };
      return Response.json({ response: 'authorized' }, { headers: { 'Meeting-Id': 'internal', 'Meeting-External-Id': 'lesson',
        'User-Id': 'w_student', 'User-External-Id': '29', 'User-Is-Moderator': 'false', 'User-Currently-Online': 'true' } });
    } });
  assert.deepEqual(await verify({ sessionToken: 'fixture-bbb', cookie: 'fixture-cookie=1' }),
    { meetingId: 'internal', externalMeetingId: 'lesson', participantId: 'w_student', extId: '29', moderator: false, online: true });
  assert.equal(request.options.headers['x-session-token'], 'fixture-bbb');
  assert.equal(request.options.headers.Cookie, 'fixture-cookie=1');
  assert.equal(request.options.redirect, 'error');
  assert.doesNotMatch(request.url, /fixture-bbb/);
});

test('removed/offline BBB session never counts as current membership and malformed role is denied', async () => {
  const verify = createBbbProofVerifier({ hookUrl: 'http://127.0.0.1:8090/bigbluebutton/connection/checkGraphqlAuthorization',
    fetchImpl: async () => Response.json({ response: 'authorized' }, { headers: { 'User-Is-Moderator': 'false', 'User-Currently-Online': 'false' } }) });
  assert.equal((await verify({ sessionToken: 'fixture-old' })).online, false);
  await assert.rejects(verify({ sessionToken: 'invalid\r\nheader' }));
  const invalid = createBbbProofVerifier({ hookUrl: 'https://bbb.example/bigbluebutton/connection/checkGraphqlAuthorization',
    fetchImpl: async () => Response.json({ response: 'authorized' }) });
  await assert.rejects(invalid({ sessionToken: 'fixture' }));
});

test('Core reader uses existing exact context API, Bearer auth, omitted cookies and no redirect', async () => {
  let request;
  const context = { data: { meetingId: 'lesson', teacher: { personId: '17' }, students: [] } };
  const reader = createClassroomReader({ coreOrigin: 'https://core.example', fetchImpl: async (url, options) => {
    request = { url, options }; return Response.json(context);
  } });
  assert.deepEqual(await reader('fixture-core'), context);
  assert.equal(request.url, 'https://core.example/api/integrations/bbb/classroom/context');
  assert.equal(request.options.headers.Authorization, 'Bearer fixture-core');
  assert.equal(request.options.headers.Cookie, undefined);
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.cache, 'no-store');
});

test('trust endpoints reject HTTP external origins, credentials, query parameters and arbitrary paths', () => {
  for (const coreOrigin of ['http://core.example', 'https://user:pass@core.example', 'https://core.example/?token=x', 'https://core.example/path']) {
    assert.throws(() => createClassroomReader({ coreOrigin }));
  }
  assert.throws(() => createBbbProofVerifier({ hookUrl: 'http://arbitrary.example/bigbluebutton/connection/checkGraphqlAuthorization' }));
  assert.throws(() => createBbbProofVerifier({ hookUrl: 'https://bbb.example/other' }));
});