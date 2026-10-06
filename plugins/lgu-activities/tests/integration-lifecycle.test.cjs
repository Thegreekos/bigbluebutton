const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { useLiveIntegration } = require('../src/use-integration');

function harness() {
  let metadata = { loading: false, data: { user_metadata: [{ parameter: 'schoolcore_context_token', value: 'fixture-core-self' }] } };
  let user = { loading: false, data: { userId: 'w_teacher', extId: '17', role: 'MODERATOR' } };
  let settings = { loading: false, data: { liveActivityId: 'fixture-live-one' } };
  let sessionToken = 'fixture-bbb-self';
  const pluginApi = { useCustomQuery: () => metadata,
    usePluginSettings: () => settings,
    useCustomSubscription: () => ({ loading: false, data: { user: [] } }),
    getSessionToken: () => sessionToken };
  let state;
  let renders = 0;
  function Hook() { state = useLiveIntegration(pluginApi, user); renders += 1; return null; }
  return { Hook, get state() { return state; }, get renders() { return renders; },
    setMetadata(value) { metadata = value; }, setUser(value) { user = value; },
    setSettings(value) { settings = value; }, setSessionToken(value) { sessionToken = value; },
    loseProof() { metadata = { loading: false, error: new Error('synthetic metadata unavailable') }; } };
}
const response = (identity = {}, extra = {}) => Response.json({ identity: { mode: 'core', organiser: true,
  persistentHistoryEligible: true, role: 'teacher', personId: '17', participantId: 'w_teacher', ...identity },
  classroom: { teacher: { personId: '17' }, students: [] }, expiresAt: Math.floor(Date.now() / 1000) + 120, ...extra });

test('late identity response after close is aborted and cannot update disposed panel', async (t) => {
  const h = harness();
  let finish;
  let signal;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    signal = options.signal;
    return new Promise((resolve) => { finish = resolve; });
  });
  let root;
  await act(async () => { root = create(React.createElement(h.Hook)); });
  assert.equal(h.state.status, 'loading');
  await act(async () => root.unmount());
  const renders = h.renders;
  assert.equal(signal.aborted, true);
  await act(async () => finish(response()));
  assert.equal(h.renders, renders);
});

test('metadata retrieval failure disables Live and clears previously verified identity, not guest fallback', async (t) => {
  const h = harness();
  t.mock.method(globalThis, 'fetch', async () => response());
  let root;
  await act(async () => { root = create(React.createElement(h.Hook)); });
  assert.equal(h.state.ready, true);
  assert.equal(h.state.canPrepare, true);
  assert.doesNotMatch(JSON.stringify(h.state), /fixture-core-|fixture-bbb-/);
  h.loseProof();
  await act(async () => root.update(React.createElement(h.Hook)));
  assert.equal(h.state.ready, false);
  assert.equal(h.state.canPrepare, false);
  assert.equal(h.state.identity, undefined);
  await act(async () => root.unmount());
});

test('valid absent metadata verifies a guest organiser without matching Core person ID and omits Authorization', async (t) => {
  const h = harness();
  h.setMetadata({ loading: false, data: { data: { user_metadata: [] } } });
  h.setUser({ loading: false, data: { userId: 'w_teacher', role: 'MODERATOR' } });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/contexts')) return Response.json({ identityToken: 'fixture-activity-private',
      context: { id: 'guest-context', activityId: 'fixture-live-one', lguSessionId: null },
      identity: { mode: 'guest', organiser: true }, expiresAt: Math.floor(Date.now() / 1000) + 120 });
    return response({ mode: 'guest', organiser: true, role: 'guest', personId: null, persistentHistoryEligible: false },
      { classroom: null, enrichmentStatus: 'not-applicable' });
  });
  let root;
  await act(async () => { root = create(React.createElement(h.Hook)); });
  t.after(() => act(() => root.unmount()));
  assert.equal(h.state.ready, true);
  assert.equal(h.state.canPrepare, true);
  assert.equal(h.state.identity.mode, 'guest');
  await act(async () => h.state.prepare());
  assert.equal(h.state.status, 'prepared');
  assert.deepEqual(requests.map(r => JSON.parse(r.options.body)), [{}, { activityId: 'fixture-live-one' }]);
  assert.ok(requests.every(r => !Object.hasOwn(r.options.headers, 'Authorization')));
  assert.ok(requests.every(r => r.options.headers['X-BBB-Session-Token'] === 'fixture-bbb-self'));
  assert.doesNotMatch(JSON.stringify(h.state), /fixture-activity-private|fixture-bbb-self/);
});

test('removing a valid Core token reauthenticates as guest instead of retaining Core identity', async (t) => {
  const h = harness();
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(options);
    return options.headers.Authorization ? response() : response({ mode: 'guest', role: 'guest', personId: null,
      persistentHistoryEligible: false }, { classroom: null });
  });
  let root;
  await act(async () => { root = create(React.createElement(h.Hook)); });
  t.after(() => act(() => root.unmount()));
  assert.equal(h.state.identity.mode, 'core');
  h.setMetadata({ loading: false, data: { user_metadata: [] } });
  await act(async () => root.update(React.createElement(h.Hook)));
  assert.equal(requests.length, 2);
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].headers.Authorization, undefined);
  assert.equal(h.state.identity.mode, 'guest');
  assert.equal(h.state.identity.personId, null);
  assert.equal(h.state.ready, true);
});

for (const [label, metadata] of [
  ['loading', { loading: true }], ['nested loading', { loading: false, data: { loading: true, user_metadata: [] } }],
  ['error', { loading: false, error: new Error('synthetic') }],
  ['nested error', { loading: false, data: { error: {} } }], ['missing rows', { loading: false, data: {} }],
  ['duplicate tokens', { loading: false, data: { user_metadata: [
    { parameter: 'schoolcore_context_token', value: 'one' }, { parameter: 'schoolcore_context_token', value: 'two' }] } }],
  ['malformed token', { loading: false, data: { user_metadata: [{ parameter: 'schoolcore_context_token', value: {} }] } }],
  ['empty token', { loading: false, data: { user_metadata: [{ parameter: 'schoolcore_context_token', value: '  ' }] } }],
]) {
  test(`invalid metadata (${label}) never requests identity or falls back to guest`, async (t) => {
    const h = harness(); h.setMetadata(metadata);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => { calls += 1; return response(); });
    let root;
    await act(async () => { root = create(React.createElement(h.Hook)); });
    t.after(() => act(() => root.unmount()));
    assert.equal(calls, 0);
    assert.equal(h.state.ready, false);
    assert.equal(h.state.canPrepare, false);
    assert.equal(h.state.identity, undefined);
  });
}

for (const [label, identity, extra] of [
  ['Core student organiser', { role: 'student' }, {}],
  ['Core viewer association', { organiser: false }, {}],
  ['wrong Core person', { personId: 'different-person' }, {}],
  ['missing mode', { mode: undefined }, {}], ['unknown mode', { mode: 'legacy' }, {}],
  ['missing organiser', { organiser: undefined }, {}], ['truthy organiser', { organiser: 'true' }, {}],
  ['wrong participant', { participantId: 'other' }, {}],
  ['guest with Core person', { mode: 'guest', personId: '17', persistentHistoryEligible: false }, {}],
  ['guest with persistent history', { mode: 'guest', personId: null, persistentHistoryEligible: true }, {}],
  ['guest without explicit history', { mode: 'guest', personId: null, persistentHistoryEligible: undefined }, {}],
  ['expired identity', {}, { expiresAt: Math.floor(Date.now() / 1000) - 1 }],
]) {
  test(`hook validates mode/organiser/self binding: ${label}`, async (t) => {
    const h = harness();
    t.mock.method(globalThis, 'fetch', async () => response(identity, extra));
    let root;
    await act(async () => { root = create(React.createElement(h.Hook)); });
    t.after(() => act(() => root.unmount()));
    const valid = label === 'Core student organiser';
    assert.equal(h.state.ready, valid);
    assert.equal(h.state.canPrepare, valid);
    assert.equal(h.state.status, valid ? 'ready' : 'denied');
  });
}

test('guest ready identity still requires selected activity; missing BBB proof cannot request identity', async (t) => {
  const h = harness();
  h.setMetadata({ loading: false, data: { user_metadata: [] } });
  h.setSettings({ loading: false, data: {} });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1; return response({ mode: 'guest', personId: null, role: 'guest', persistentHistoryEligible: false });
  });
  let root;
  await act(async () => { root = create(React.createElement(h.Hook)); });
  t.after(() => act(() => root.unmount()));
  assert.equal(h.state.ready, true);
  assert.equal(h.state.canPrepare, false);
  await act(async () => h.state.prepare());
  assert.equal(calls, 1);
  h.setSessionToken(undefined);
  await act(async () => root.update(React.createElement(h.Hook)));
  assert.equal(calls, 1);
  assert.equal(h.state.ready, false);
  assert.equal(h.state.identity, undefined);
});