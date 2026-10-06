const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { useLiveIntegration } = require('../src/use-integration');

function harness() {
  let metadata = { loading: false, data: { user_metadata: [{ parameter: 'schoolcore_context_token', value: 'fixture-core-self' }] } };
  const user = { loading: false, data: { userId: 'w_teacher', extId: '17', role: 'MODERATOR' } };
  const pluginApi = { useCustomQuery: () => metadata,
    usePluginSettings: () => ({ loading: false, data: { liveActivityId: 'fixture-live-one' } }),
    useCustomSubscription: () => ({ loading: false, data: { user: [] } }),
    getSessionToken: () => 'fixture-bbb-self' };
  let state;
  let renders = 0;
  function Hook() { state = useLiveIntegration(pluginApi, user); renders += 1; return null; }
  return { Hook, get state() { return state; }, get renders() { return renders; },
    loseProof() { metadata = { loading: false, error: new Error('synthetic metadata unavailable') }; } };
}
const response = () => Response.json({ identity: { role: 'teacher', personId: '17', participantId: 'w_teacher' },
  classroom: { teacher: { personId: '17' }, students: [] }, expiresAt: Math.floor(Date.now() / 1000) + 120 });

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

test('loss of Core metadata proof disables Live and clears previously verified identity', async (t) => {
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