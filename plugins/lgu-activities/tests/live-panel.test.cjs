const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { renderToStaticMarkup } = require('react-dom/server');
const { LivePanel } = require('../src/live-panel');
const { USER_METADATA_QUERY } = require('../src/integration-client');
const h = React.createElement;
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const options = [{ id: 'a', text: '<b>Alpha</b>', imageUrl: 'https://not-requested.invalid/image' },
  { id: 'b', text: 'Beta' }, { id: 'c', text: 'Gamma' }, { id: 'd', text: 'Delta' }];
function view(overrides = {}) {
  return { id: 'room', themeTitle: 'History', phase: 'open', phaseVersion: 7, questionIndex: 0,
    questionCount: 2, lastSeq: 8, role: 'participant', entry: 'closed',
    question: { id: 'question', kind: 'choice', prompt: '<script>not HTML</script>', index: 0, total: 2, options },
    own: null, reveal: null, me: { participantId: 'person', kind: 'guest', removed: false, joinedPhaseVersion: 0 },
    participants: [{ participantId: 'person', kind: 'guest', nickname: 'Learner', eligible: true, removed: false, answered: false }],
    standings: [{ participantId: 'person', nickname: 'Learner', total: 777, rank: 3 }], ...overrides };
}
function fixture(t, { host = false, core = false, canHost = host, metadata, phase = 'lobby', joined = false } = {}) {
  const originalFetch = globalThis.fetch;
  const f = { requests: [], cancelled: 0, stream: null, status: {},
    metadata: metadata || { loading: false, data: { user_metadata: core
      ? [{ parameter: 'schoolcore_context_token', value: 'core-proof' }] : [] } },
    user: { loading: false, data: { userId: 'bbb-person', role: host ? 'MODERATOR' : 'VIEWER', extId: 'self' } },
    state: view(host ? { role: 'host', me: null, phase: 'lobby', question: null } : {}),
    context: { principal: { id: 'principal', role: canHost ? 'moderator' : 'viewer', identityKind: core ? 'core' : 'guest',
      displayName: 'Participant', canHost }, themes: canHost ? [{ id: 'history', title: 'History' }] : null,
    sessions: [{ id: 'room', themeTitle: 'History', phase, joined, live: !['finished', 'cancelled'].includes(phase) }] } };
  f.api = { useCurrentUser: () => f.user,
    useCustomQuery(query) { assert.equal(query, USER_METADATA_QUERY); return f.metadata; }, getSessionToken: () => 'bbb-proof' };
  globalThis.fetch = async (url, opts) => {
    const route = url.split('/').at(-1);
    f.requests.push({ route, url, opts, body: JSON.parse(opts.body) });
    if (f.handler) { const result = await f.handler(route, opts); if (result) return result; }
    if (f.status[route]) return { ok: false, status: f.status[route], json: async () => ({ error: 'PRIVATE secret URL' }) };
    if (route === 'stream') return { ok: true, headers: { get: () => 'text/event-stream' },
      body: new ReadableStream({ start(c) { f.stream = c; }, cancel() { f.cancelled++; } }) };
    const payload = { context: f.context, state: { session: f.state },
      create: { session: { id: 'room', phase: 'lobby', entry: 'closed' } },
      enter: { sessionId: 'room', participant: { participantId: 'person', kind: core ? 'account' : 'guest', displayName: 'Learner' }, created: !joined },
      command: { phase: f.state.phase, phaseVersion: f.state.phaseVersion }, answer: { accepted: true, elapsedMs: 900 } }[route];
    assert.ok(payload, `unexpected route ${route}`);
    return { ok: true, json: async () => payload };
  };
  f.mount = async () => { await act(async () => { f.root = create(h(LivePanel, { pluginApi: f.api })); await flush(); }); };
  f.update = async () => { await act(async () => { f.root.update(h(LivePanel, { pluginApi: f.api })); await flush(); }); };
  f.find = id => f.root.root.findByProps({ 'data-testid': id });
  f.click = async id => { await act(async () => { f.find(id).props.onClick(); await flush(); }); };
  f.change = async (id, value) => { await act(async () => { f.find(id).props.onChange({ target: { value } }); await flush(); }); };
  f.enter = async () => { await f.change('live-session-picker', 'room'); await f.click('live-enter'); };
  f.notify = async () => { await act(async () => { f.stream.enqueue(new TextEncoder().encode('event: phase\ndata: {"seq":9}\n\n')); await flush(); }); };
  f.text = () => JSON.stringify(f.root.toJSON());
  t.after(async () => { if (f.root) await act(async () => { f.root.unmount(); await flush(); }); globalThis.fetch = originalFetch; });
  return f;
}

test('all users wait for valid self metadata; valid absence enables guest and errors never downgrade', async t => {
  const f = fixture(t, { metadata: { loading: true } });
  await f.mount(); assert.equal(f.requests.length, 0); assert.match(f.text(), /Waiting for participant metadata/);
  f.metadata = { loading: false, data: { data: { user_metadata: [] } } };
  await f.update(); assert.deepEqual(f.requests.map(r => r.route), ['context']);
  assert.equal(f.requests[0].opts.headers.Authorization, undefined); assert.match(f.text(), /Temporary guest/);
  for (const metadata of [
    { loading: false, error: new Error('private'), data: { user_metadata: [] } },
    { loading: false, data: { user_metadata: [{ parameter: 'schoolcore_context_token', value: '' }] } },
    { loading: false, data: {} },
    { loading: false, data: { user_metadata: [{ parameter: 'schoolcore_context_token', value: 'a' }, { parameter: 'schoolcore_context_token', value: 'b' }] } },
  ]) {
    const before = f.requests.length; f.metadata = metadata; await f.update();
    assert.equal(f.requests.length, before); assert.equal(f.root.root.findAllByType('button').length, 0);
    assert.doesNotMatch(f.text(), /private/);
  }
});

test('Core viewer uses own proof, enters before state, never gets organiser controls or leaks proof', async t => {
  const f = fixture(t, { core: true }); await f.mount(); await f.enter();
  assert.deepEqual(f.requests.slice(0, 4).map(r => r.route), ['context', 'enter', 'state', 'stream']);
  assert.equal(f.requests[0].opts.headers.Authorization, 'Bearer core-proof');
  assert.deepEqual(f.requests[1].body, { sessionId: 'room' });
  assert.equal(f.root.root.findAllByProps({ 'data-testid': 'live-host' }).length, 0);
  assert.equal(f.root.root.findAllByProps({ 'aria-label': 'Host commands' }).length, 0);
  assert.doesNotMatch(f.text(), /bbb-proof|core-proof|imageUrl|https:\/\//);
});

test('guest moderator hosts only with server canHost; create and all commands use latest state version', async t => {
  const f = fixture(t, { host: true }); await f.mount();
  assert.match(f.text(), /Temporary guest/); assert.equal(f.find('live-create').props.disabled, true);
  await f.change('live-theme', 'history'); await f.click('live-create');
  assert.deepEqual(f.requests.find(r => r.route === 'create').body, { topicId: 'history' });
  assert.ok(!f.requests.some(r => r.route === 'enter'));
  const actions = ['start', 'open', 'close', 'reveal', 'next', 'finish'];
  for (let i = 0; i < actions.length; i++) {
    f.state = { ...f.state, phaseVersion: 20 + i };
    await f.notify(); await f.click('live-command-' + actions[i]);
    assert.deepEqual(f.requests.filter(r => r.route === 'command').at(-1).body,
      { sessionId: 'room', action: actions[i], expectedVersion: 20 + i });
  }
  assert.equal(f.root.root.findAllByProps({ 'data-testid': 'live-standings' }).length, 0);
});

test('BBB moderator alone is not authority, and BBB viewer cannot display server moderator UI', async t => {
  const f = fixture(t, { host: true, canHost: false }); await f.mount();
  assert.equal(f.root.root.findAllByProps({ 'data-testid': 'live-host' }).length, 0);
  f.context.principal = { ...f.context.principal, canHost: true, role: 'moderator' };
  f.context.themes = [{ id: 'history', title: 'History' }];
  f.user.data.role = 'VIEWER'; await f.update();
  assert.equal(f.root.root.findAllByProps({ 'data-testid': 'live-host' }).length, 0);
});

for (const kind of ['choice', 'boolean', 'image', 'cloze', 'order', 'match']) {
  test(`${kind}: inline escaped rendering and exact LGU string-array answer with no local marking`, async t => {
    const f = fixture(t);
    f.state.question = { ...f.state.question, kind, options: kind === 'boolean' ? options.slice(0, 2) : options,
      ...(kind === 'match' ? { rightOptions: options.map(o => ({ id: 'right-' + o.id, text: 'Right ' + o.id })) } : {}) };
    await f.mount(); await f.enter();
    assert.match(f.text(), /<script>not HTML<\/script>/);
    assert.equal(f.root.root.findAllByType('iframe').length, 0); assert.equal(f.root.root.findAllByType('a').length, 0);
    let expected;
    if (kind === 'order') {
      await act(async () => { f.root.root.findByProps({ 'aria-label': 'Move <b>Alpha</b> down' }).props.onClick(); });
      expected = ['b', 'a', 'c', 'd'];
    } else if (kind === 'match') {
      const matches = f.root.root.findAllByType('select').filter(s => s.props['aria-label']?.startsWith('Match '));
      for (let i = 0; i < matches.length; i++) await act(async () => {
        matches[i].props.onChange({ target: { value: 'right-' + options[options.length - i - 1].id } });
      });
      expected = ['right-d', 'right-c', 'right-b', 'right-a'];
    } else {
      await act(async () => { f.root.root.findAllByType('input')[1].props.onChange(); }); expected = ['b'];
    }
    assert.equal(f.find('live-answer').props.disabled, false); await f.click('live-answer');
    assert.deepEqual(f.requests.find(r => r.route === 'answer').body,
      { sessionId: 'room', questionIndex: 0, phaseVersion: 7, answer: expected });
    assert.equal(f.find('live-answer').props.disabled, true); assert.match(f.text(), /Answer received/);
    assert.doesNotMatch(f.text(), /Points:|Total:|Rank:|Correct ·|Incorrect ·/);
    await f.click('live-answer'); assert.equal(f.requests.filter(r => r.route === 'answer').length, 1);
  });
}

test('markup is escaped by React (never injected), including malicious option text', async t => {
  const f = fixture(t); await f.mount(); await f.enter();
  // Render a DOM host subtree to verify React escaping rather than inspecting
  // renderer JSON alone. The UI never uses dangerouslySetInnerHTML.
  const legend = f.root.root.findByType('legend');
  const html = renderToStaticMarkup(h('legend', null, ...legend.children));
  assert.match(html, /&lt;script&gt;not HTML&lt;\/script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.ok(f.root.root.findAll(node => Boolean(node.props.dangerouslySetInnerHTML)).length === 0);
});

test('unknown multi-select kind is unsupported in pinned LGU; duplicate matching is not submitted', async t => {
  const f = fixture(t); f.state.question.kind = 'multi'; await f.mount(); await f.enter();
  assert.equal(f.find('live-answer').props.disabled, true); assert.match(f.text(), /not supported/);
  await f.click('live-answer'); assert.ok(!f.requests.some(r => r.route === 'answer'));
  f.state = view({ question: { ...view().question, id: 'match-question', kind: 'match',
    rightOptions: options.map(o => ({ id: 'r-' + o.id, text: o.text })) } });
  await f.notify();
  for (const select of f.root.root.findAllByType('select').filter(s => s.props['aria-label']?.startsWith('Match '))) {
    await act(async () => select.props.onChange({ target: { value: 'r-a' } }));
  }
  assert.equal(f.find('live-answer').props.disabled, true);
});

test('own correctness/points and LGU total/rank appear only on reveal; finish has standings only', async t => {
  const f = fixture(t); f.state.own = { submitted: ['a'], correct: true, points: 143, elapsedMs: 900, late: false };
  await f.mount(); await f.enter();
  for (const phase of ['prepare', 'open', 'closed']) {
    f.state = { ...f.state, phase, phaseVersion: f.state.phaseVersion + 1 }; await f.notify();
    assert.equal(f.root.root.findAllByProps({ 'data-testid': 'live-own-result' }).length, 0);
    assert.equal(f.root.root.findAllByProps({ 'data-testid': 'live-standings' }).length, 0);
  }
  f.state = { ...f.state, phase: 'reveal', phaseVersion: 30 }; await f.notify();
  assert.match(f.text(), /Correct · Points: 143/); assert.match(f.text(), /Rank: 3 · Total: 777/);
  f.state = { ...f.state, phase: 'finished', phaseVersion: 31, question: null, own: null }; await f.notify();
  assert.match(f.text(), /Rank: 3 · Total: 777/);
  assert.equal(f.root.root.findAllByProps({ 'data-testid': 'live-own-result' }).length, 0);
});

test('lobby entry is available, newcomer after start is disabled, joined returning participant may enter', async t => {
  const f = fixture(t, { phase: 'open' }); await f.mount(); await f.change('live-session-picker', 'room');
  assert.equal(f.find('live-enter').props.disabled, true); await f.click('live-enter');
  assert.ok(!f.requests.some(r => r.route === 'enter'));
  f.context.sessions[0].joined = true; await f.click('live-refresh-context');
  await f.change('live-session-picker', 'room'); assert.equal(f.find('live-enter').props.disabled, false);
  await f.click('live-enter'); assert.equal(f.requests.filter(r => r.route === 'enter').length, 1);
});

test('not eligible, removed, closed or already answered participants cannot answer', async t => {
  const f = fixture(t); f.state.participants[0].eligible = false; await f.mount(); await f.enter();
  assert.equal(f.find('live-answer').props.disabled, true);
  for (const state of [view({ phase: 'closed', phaseVersion: 8 }),
    view({ me: { ...view().me, removed: true }, phaseVersion: 9 }),
    view({ own: { submitted: ['b'], correct: false, points: 0, elapsedMs: 900, late: false }, phaseVersion: 10 })]) {
    f.state = state; await f.notify(); assert.equal(f.find('live-answer').props.disabled, true);
    await f.click('live-answer');
  }
  assert.ok(!f.requests.some(r => r.route === 'answer'));
});

test('failed state closes moderator controls, sanitized error and explicit reconnect context only', async t => {
  const f = fixture(t, { host: true }); f.status.state = 401; await f.mount(); await f.enter();
  assert.match(f.text(), /Connection expired/); assert.doesNotMatch(f.text(), /PRIVATE|secret|URL/);
  assert.equal(f.root.root.findAllByProps({ 'data-testid': 'live-host' }).length, 0);
  assert.equal(f.root.root.findAllByProps({ 'data-testid': 'live-state' }).length, 0);
  assert.equal(f.requests.filter(r => r.route === 'context').length, 1);
  assert.ok(!f.requests.some(r => r.route === 'stream' || r.route === 'command'));
  delete f.status.state; await f.click('live-reconnect');
  assert.equal(f.requests.filter(r => r.route === 'context').length, 2);
  assert.equal(f.requests.filter(r => r.route === 'state').length, 1); // no automatic re-entry
});

test('stale command is not retried, old controls removed and stream aborted', async t => {
  const f = fixture(t, { host: true }); await f.mount(); await f.enter();
  f.status.command = 409; await f.click('live-command-start');
  assert.match(f.text(), /session changed/); assert.equal(f.requests.filter(r => r.route === 'command').length, 1);
  assert.equal(f.requests.find(r => r.route === 'stream').opts.signal.aborted, true);
  assert.equal(f.cancelled, 1); assert.equal(f.root.root.findAllByProps({ 'aria-label': 'Host commands' }).length, 0);
});

test('failed answer is never retried or marked locally; only explicit reconnect survives', async t => {
  const f = fixture(t); await f.mount(); await f.enter();
  await act(async () => f.root.root.findAllByType('input')[0].props.onChange());
  f.status.answer = 500; await f.click('live-answer');
  assert.equal(f.requests.filter(r => r.route === 'answer').length, 1);
  assert.doesNotMatch(f.text(), /Answer received|Points:|Rank:|PRIVATE/);
  assert.equal(f.root.root.findAllByType('button').length, 1);
});

test('busy guard suppresses double taps; unmount aborts active stream and metadata loss fail closes', async t => {
  const f = fixture(t, { host: true }); await f.mount(); await f.enter();
  let release;
  f.handler = route => route === 'command' ? new Promise(resolve => { release = () => resolve({ ok: true,
    json: async () => ({ phase: 'prepare', phaseVersion: 8 }) }); }) : undefined;
  const click = f.find('live-command-start').props.onClick;
  await act(async () => { click(); click(); await flush(); });
  assert.equal(f.requests.filter(r => r.route === 'command').length, 1);
  assert.equal(f.find('live-command-start').props.disabled, true);
  await act(async () => { release(); await flush(); });
  f.metadata = { loading: false, error: new Error('metadata lost') }; await f.update();
  assert.equal(f.root.root.findAllByType('button').length, 0); assert.equal(f.cancelled, 1);
  assert.equal(f.requests.find(r => r.route === 'stream').opts.signal.aborted, true);
  f.metadata = { loading: false, data: { user_metadata: [] } }; await f.update(); await f.enter();
  await act(async () => { f.root.unmount(); await flush(); }); f.root = null;
  assert.equal(f.cancelled, 2);
});

test('current-user loading/error gates metadata and aborts existing session on user loss', async t => {
  const f = fixture(t); f.user = { loading: true };
  await f.mount(); assert.equal(f.requests.length, 0);
  f.user = { loading: false, error: new Error('private'), data: { userId: 'bbb-person', role: 'VIEWER' } };
  await f.update(); assert.equal(f.requests.length, 0);
  f.user = { loading: false, data: { userId: 'bbb-person', role: 'VIEWER' } };
  await f.update(); await f.enter();
  f.user = { loading: false, data: { userId: '', role: 'VIEWER' } };
  await f.update(); assert.equal(f.cancelled, 1); assert.equal(f.root.root.findAllByType('button').length, 0);
});

test('older phase read cannot replace the newer phase; next question resets input and receipt', async t => {
  const f = fixture(t); await f.mount(); await f.enter();
  await act(async () => f.root.root.findAllByType('input')[0].props.onChange()); await f.click('live-answer');
  f.state = view({ phase: 'reveal', phaseVersion: 9, own: { submitted: ['a'], correct: false,
    points: 0, elapsedMs: 900, late: false } }); await f.notify();
  assert.match(f.text(), /Incorrect · Points: 0/);
  f.state = view(); await f.notify(); assert.match(f.text(), /Phase: reveal/);
  f.state = view({ phaseVersion: 11, questionIndex: 1, question: { ...view().question, id: 'next-question', index: 1 } });
  await f.notify();
  assert.equal(f.find('live-answer').props.disabled, true); assert.doesNotMatch(f.text(), /Answer received/);
  await act(async () => f.root.root.findAllByType('input')[1].props.onChange());
  await f.click('live-answer');
  assert.deepEqual(f.requests.filter(r => r.route === 'answer').at(-1).body,
    { sessionId: 'room', questionIndex: 1, phaseVersion: 11, answer: ['b'] });
});