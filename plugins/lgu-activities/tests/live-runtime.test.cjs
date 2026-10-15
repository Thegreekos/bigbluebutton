const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { useLiveRuntime } = require('../src/live-runtime');

const h = React.createElement;
const flush = async () => { for (let i = 0; i < 50; i += 1) await Promise.resolve(); };
function fixtureSession(phase = 'open') {
  const question = ['lobby', 'finished'].includes(phase) ? null : { id: 'question', kind: 'choice', prompt: 'Odyssey', index: 0,
    total: 1, options: [{ id: 'a', text: 'Option A' }, { id: 'b', text: 'Option B' }] };
  return { id: 'room', themeTitle: 'Odyssey', phase, phaseVersion: phase === 'finished' ? 3 : phase === 'lobby' ? 1 : 2,
    questionIndex: 0, questionCount: 1, lastSeq: phase === 'finished' ? 3 : 1,
    role: 'participant', participants: [{ participantId: 'student', kind: 'account', nickname: 'Student',
      removed: false, eligible: true, answered: false }], standings: [], question, me: { participantId: 'student',
      kind: 'account', removed: false, joinedPhaseVersion: 0 }, own: null, reveal: null };
}

test('viewer enters invisibly in lobby, mounts on active state, then restores presentation at finish', async t => {
  const originalFetch = globalThis.fetch;
  let current = fixtureSession('lobby');
  let streamController;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    const route = new URL(url, 'https://bbb.invalid').pathname.split('/').at(-1);
    const body = JSON.parse(init.body);
    requests.push({ route, body });
    if (route === 'context') return new Response(JSON.stringify({
      principal: { id: 'principal', role: 'viewer', identityKind: 'core', displayName: 'Student', canHost: false },
      themes: null, sessions: [{ id: 'room', themeTitle: 'Odyssey', phase: current.phase, joined: current.phase !== 'lobby', live: true }],
    }), { headers: { 'Content-Type': 'application/json' } });
    if (route === 'state') return new Response(JSON.stringify({ session: current }), { headers: { 'Content-Type': 'application/json' } });
    if (route === 'stream') return new Response(new ReadableStream({ start(controller) { streamController = controller; } }), {
      headers: { 'Content-Type': 'text/event-stream' },
    });
    throw new Error(`unexpected route: ${route}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const user = { loading: false, data: { userId: 'student', role: 'VIEWER', extId: 'person' } };
  const api = { useCustomQuery: () => ({ loading: false, data: { user_metadata: [{ parameter: 'schoolcore_context_token', value: 'core-proof' }] } }),
    getSessionToken: () => 'bbb-proof' };
  let runtime;
  function Probe() {
    runtime = useLiveRuntime(api, user);
    return h('output', { 'data-stage': runtime.controller.showMainStage ? 'mounted' : 'presentation',
      'data-session': runtime.controller.session?.id || '' }, runtime.controller.status);
  }
  let root;
  await act(async () => { root = create(h(Probe)); await flush(); });
  assert.equal(runtime.controller.selectedId, 'room');
  assert.equal(runtime.controller.showMainStage, false);
  assert.equal(runtime.controller.session.phase, 'lobby');
  assert.ok(requests.some(request => request.route === 'state' && request.body.sessionId === 'room'));
  assert.ok(requests.some(request => request.route === 'stream'));
  assert.equal(root.root.findByType('output').props['data-stage'], 'presentation');

  current = fixtureSession('open');
  await act(async () => {
    streamController.enqueue(new TextEncoder().encode('event: phase\ndata: {"seq":2}\n\n'));
    await flush();
  });
  assert.equal(runtime.controller.session.phase, 'open');
  assert.equal(runtime.controller.showMainStage, true);
  assert.equal(root.root.findByType('output').props['data-stage'], 'mounted');

  current = fixtureSession('finished');
  await act(async () => {
    streamController.enqueue(new TextEncoder().encode('event: phase\ndata: {"seq":3}\n\n'));
    await flush();
  });
  assert.equal(runtime.controller.session.phase, 'finished');
  assert.equal(runtime.controller.showMainStage, false);
  assert.equal(root.root.findByType('output').props['data-stage'], 'presentation');
  await act(async () => { root.unmount(); await flush(); });
});

for (const [status, polls] of [[403, false], [503, true]]) {
  test(`a context answered ${status} ${polls ? 'keeps polling' : 'stops polling (a standing refusal is not retried)'}`, async t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const originalFetch = globalThis.fetch;
    let contexts = 0;
    globalThis.fetch = async url => {
      const route = new URL(url, 'https://bbb.invalid').pathname.split('/').at(-1);
      if (route !== 'context') throw new Error(`unexpected route: ${route}`);
      contexts += 1;
      return new Response(JSON.stringify({ error: 'refused' }), { status, headers: { 'Content-Type': 'application/json' } });
    };
    t.after(() => { globalThis.fetch = originalFetch; });
    const user = { loading: false, data: { userId: 'moderator', role: 'MODERATOR', extId: 'person' } };
    const api = { useCustomQuery: () => ({ loading: false, data: { user_metadata: [{ parameter: 'schoolcore_context_token', value: 'core-proof' }] } }),
      getSessionToken: () => 'bbb-proof' };
    let runtime;
    function Probe() { runtime = useLiveRuntime(api, user); return null; }
    let root;
    await act(async () => { root = create(h(Probe)); await flush(); });
    assert.equal(contexts, 1);
    assert.equal(runtime.controller.status, 'failed');
    for (let i = 0; i < 3; i += 1) await act(async () => { t.mock.timers.tick(3000); await flush(); });
    assert.equal(contexts, polls ? 4 : 1);
    assert.equal(runtime.controller.error, status === 403 ? 'Live access is not permitted for this meeting.' : 'Live service is unavailable.');
    await act(async () => { root.unmount(); await flush(); });
  });
}
