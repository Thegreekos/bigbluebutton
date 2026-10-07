const React = require('react');
const { USER_METADATA_QUERY, metadataState, extractCoreToken } = require('./integration-client');
const { createFederationClient, errorMessage } = require('./federation-client');
const h = React.createElement;
const SINGLE = ['choice', 'boolean', 'image', 'cloze'];
const ACTIONS = ['start', 'open', 'close', 'reveal', 'next', 'finish'];
const STYLE = `
.lgu-live { padding: 20px; color: #172b43; background: #f7f9fc; font: 16px/1.5 system-ui,sans-serif; }
.lgu-live button,.lgu-live select { font: inherit; padding: 8px 12px; margin: 4px; border: 1px solid #bdcadd; border-radius: 8px; background: white; color: inherit; }
.lgu-live button { cursor: pointer; } .lgu-live button:disabled { opacity: .55; cursor: not-allowed; }
.lgu-live button:focus-visible,.lgu-live select:focus-visible { outline: 3px solid #5165ba; }
.lgu-live fieldset { border: 1px solid #bdcadd; border-radius: 12px; padding: 16px; margin: 16px 0; }
.lgu-live label { display: block; padding: 6px; } .lgu-live__result { padding: 12px; background: #e8eef7; border-radius: 12px; }
`;

// Answer is string[] in the pinned quiz domain. Matching retains the ORIGINAL
// left option order; ordering is a permutation of option IDs. No marking here.
function QuestionForm({ session, disabled, onAnswer }) {
  const q = session.question;
  const [answer, setAnswer] = React.useState(() => q.kind === 'order' ? q.options.map(o => o.id)
    : q.kind === 'match' ? q.options.map(() => '') : []);
  const supported = SINGLE.includes(q.kind) || ['order', 'match'].includes(q.kind);
  const complete = SINGLE.includes(q.kind) ? answer.length === 1
    : supported && answer.length === q.options.length && answer.every(Boolean) && new Set(answer).size === answer.length;
  const setSlot = (index, value) => setAnswer(previous => previous.map((v, i) => i === index ? value : v));
  return h('fieldset', { disabled, 'data-testid': 'live-question' },
    h('legend', null, `${q.index + 1} / ${q.total}: ${q.prompt}`),
    SINGLE.includes(q.kind) ? q.options.map(option => h('label', { key: option.id },
      h('input', { type: 'radio', name: `answer-${q.id}`, value: option.id,
        checked: answer[0] === option.id, onChange: () => setAnswer([option.id]) }), option.text))
      : q.kind === 'order' ? h('ol', null, ...answer.map((optionId, index) => {
        const option = q.options.find(o => o.id === optionId);
        const move = offset => setAnswer(previous => {
          const next = [...previous];
          [next[index], next[index + offset]] = [next[index + offset], next[index]];
          return next;
        });
        return h('li', { key: optionId }, option.text,
          h('button', { type: 'button', disabled: disabled || index === 0,
            'aria-label': `Move ${option.text} up`, onClick: () => move(-1) }, '↑'),
          h('button', { type: 'button', disabled: disabled || index === answer.length - 1,
            'aria-label': `Move ${option.text} down`, onClick: () => move(1) }, '↓'));
      })) : q.kind === 'match' ? q.options.map((option, index) => h('label', { key: option.id }, option.text,
        h('select', { 'aria-label': `Match ${option.text}`, value: answer[index],
          onChange: event => setSlot(index, event.target.value) },
        h('option', { value: '' }, 'Choose a match'),
        ...q.rightOptions.map(right => h('option', { key: right.id, value: right.id }, right.text)))))
        : h('p', { role: 'status' }, 'This question kind is not supported by the pinned LGU quiz contract.'),
    h('button', { type: 'button', 'data-testid': 'live-answer', disabled: disabled || !complete,
      onClick: () => { if (!disabled && complete) onAnswer([...answer]); } }, 'Submit answer'));
}

function LivePanel({ pluginApi }) {
  const user = pluginApi.useCurrentUser();
  const metadata = pluginApi.useCustomQuery(USER_METADATA_QUERY);
  const credentialState = metadataState(metadata);
  const coreToken = extractCoreToken(metadata);
  const sessionToken = pluginApi.getSessionToken();
  const userReady = user?.loading === false && !user.error && !user.data?.error
    && typeof user.data?.userId === 'string' && Boolean(user.data.userId) && ['MODERATOR', 'VIEWER'].includes(user.data.role);
  const ready = userReady && ['present', 'absent'].includes(credentialState) && Boolean(sessionToken);
  const [generation, reconnect] = React.useReducer(n => n + 1, 0);
  const [context, setContext] = React.useState(null);
  const [status, setStatus] = React.useState('loading');
  const [error, setError] = React.useState(null);
  const [topicId, setTopicId] = React.useState('');
  const [picked, setPicked] = React.useState('');
  const [sessionId, setSessionId] = React.useState('');
  const [session, setSession] = React.useState(null);
  const [mode, setMode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [accepted, setAccepted] = React.useState('');
  const clientRef = React.useRef(null);
  const watchRef = React.useRef(null);
  const busyRef = React.useRef(false);
  const canHost = ready && context?.principal.canHost === true && context.principal.role === 'moderator'
    && user.data.role === 'MODERATOR';

  React.useEffect(() => {
    setContext(null); setSession(null); setSessionId(''); setPicked(''); setTopicId('');
    setError(null); setStatus('loading'); setBusy(false); busyRef.current = false; setAccepted('');
    if (!ready) return undefined;
    const client = createFederationClient({ sessionToken, coreToken });
    clientRef.current = client;
    let current = true;
    client.context().then(value => {
      if (!current) return;
      setContext(value); setStatus('ready');
    }).catch(err => { if (current) { setError(err); setStatus('failed'); client.dispose(); } });
    return () => { current = false; watchRef.current?.stop(); watchRef.current = null;
      client.dispose(); if (clientRef.current === client) clientRef.current = null; };
  }, [pluginApi, ready, user?.data?.userId, user?.data?.role, user?.data?.extId, credentialState,
    sessionToken, coreToken, generation]);

  const fail = (err, client) => {
    if (clientRef.current !== client) return;
    watchRef.current?.stop(); client.dispose();
    setSession(null); setError(err); setStatus('failed');
  };
  React.useEffect(() => {
    setSession(null); setAccepted('');
    const client = clientRef.current;
    if (!ready || !sessionId || status !== 'ready' || !client) return undefined;
    let current = true;
    const watch = client.watch(sessionId, {
      onState(value) { if (current) setSession(previous => !previous || value.phaseVersion >= previous.phaseVersion ? value : previous); },
      onError(err) { if (current) fail(err, client); },
      onMode(value) { if (current) setMode(value); },
    });
    watchRef.current = watch;
    return () => { current = false; watch.stop(); if (watchRef.current === watch) watchRef.current = null; };
  }, [ready, sessionId, status, generation]);

  async function mutate(operation) {
    const client = clientRef.current;
    if (!ready || status !== 'ready' || !client || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await operation(client); }
    catch (err) { fail(err, client); }
    finally { if (clientRef.current === client) { busyRef.current = false; setBusy(false); } }
  }
  const shell = (...children) => h('section', { className: 'lgu-live', 'aria-label': 'LGU Live' },
    h('style', null, STYLE), h('h2', null, 'LGU Live'), ...children);
  if (!ready) return shell(h('p', { role: 'status' },
    credentialState === 'loading' || user?.loading !== false ? 'Waiting for participant metadata…'
      : 'Participant identity is unavailable. Live access is closed.'));
  if (status === 'loading') return shell(h('p', { role: 'status' }, 'Checking Live context…'));
  if (status === 'failed') return shell(h('p', { role: 'alert' }, errorMessage(error)),
    h('button', { type: 'button', 'data-testid': 'live-reconnect', onClick: reconnect }, 'Reconnect'));
  const selected = context?.sessions.find(s => s.id === picked);
  const ownParticipant = session?.participants.find(p => p.participantId === session.me?.participantId);
  const answerKey = session?.question ? `${session.id}:${session.question.id}:${session.questionIndex}` : '';
  const mayAnswer = !canHost && session?.role === 'participant' && session.phase === 'open'
    && session.me && !session.me.removed && ownParticipant?.eligible === true
    && !session.own && accepted !== answerKey && !busy;
  return shell(
    h('p', { 'data-testid': 'live-principal' },
      `${context.principal.displayName} · ${context.principal.identityKind === 'core' ? 'Core participant' : 'Temporary guest'}`),
    canHost && h('div', { 'data-testid': 'live-host' },
      h('label', null, 'Theme', h('select', { value: topicId, disabled: busy,
        'data-testid': 'live-theme', onChange: event => setTopicId(event.target.value) },
      h('option', { value: '' }, 'Choose a theme'),
      ...(context.themes || []).map(t => h('option', { key: t.id, value: t.id }, t.title)))),
      h('button', { type: 'button', disabled: busy || !context.themes?.some(t => t.id === topicId),
        'data-testid': 'live-create', onClick: () => {
          if (!canHost || !context.themes?.some(t => t.id === topicId)) return;
          void mutate(async client => { const result = await client.create(topicId);
            if (clientRef.current === client) setSessionId(result.session.id); });
        } }, 'Create session')),
    h('label', null, 'Session', h('select', { value: picked, disabled: busy,
      'data-testid': 'live-session-picker', onChange: event => setPicked(event.target.value) },
    h('option', { value: '' }, 'Choose a session'),
    ...context.sessions.map(s => h('option', { key: s.id, value: s.id }, `${s.themeTitle} · ${s.phase}`)))),
    h('button', { type: 'button', 'data-testid': 'live-enter',
      disabled: busy || !selected || (!canHost && (!selected.live || (!selected.joined && selected.phase !== 'lobby'))),
      onClick: () => {
        if (!selected || (!canHost && (!selected.live || (!selected.joined && selected.phase !== 'lobby')))) return;
        void mutate(async client => {
          if (!canHost) await client.enter(picked);
          if (clientRef.current === client) setSessionId(picked);
        });
      } }, canHost ? 'View session' : 'Enter lobby / return'),
    h('button', { type: 'button', disabled: busy, 'data-testid': 'live-refresh-context', onClick: reconnect }, 'Refresh context'),
    sessionId && !session && h('p', { role: 'status' }, 'Loading session…'),
    session && h('div', { 'data-testid': 'live-state' },
      h('h3', null, session.themeTitle), h('p', { role: 'status' }, `Phase: ${session.phase} · ${mode}`),
      session.phase === 'lobby' && h('p', null, 'Lobby: waiting for the moderator to start.'),
      session.me?.removed && h('p', { role: 'status' }, 'You have been removed from this session.'),
      canHost && session.role === 'host' && h('div', { 'aria-label': 'Host commands' },
        ...ACTIONS.map(action => h('button', { key: action, type: 'button', disabled: busy,
          'data-testid': `live-command-${action}`, onClick: () => {
            if (!canHost || session.role !== 'host') return;
            void mutate(async client => { await client.command(session.id, action, session.phaseVersion);
              await watchRef.current?.refresh(); });
          } }, action[0].toUpperCase() + action.slice(1)))),
      session.question && h(QuestionForm, { key: answerKey, session, disabled: !mayAnswer,
        onAnswer: answer => {
          if (!mayAnswer) return;
          void mutate(async client => {
            await client.answer(session.id, session.question.index, session.phaseVersion, answer);
            if (clientRef.current === client) setAccepted(answerKey);
            await watchRef.current?.refresh();
          });
        } }),
      (session.own || accepted === answerKey && answerKey) && h('p', { role: 'status' }, 'Answer received.'),
      session.phase === 'reveal' && session.own && h('p', { className: 'lgu-live__result', 'data-testid': 'live-own-result' },
        `${session.own.correct ? 'Correct' : 'Incorrect'} · Points: ${session.own.points}`),
      session.phase === 'reveal' && session.reveal && h('div', { className: 'lgu-live__result', 'data-testid': 'live-reveal' },
        h('p', null, `LGU answer: ${(session.reveal.correct || []).join(', ')}`),
        h('p', null, session.reveal.explanation)),
      ['reveal', 'finished'].includes(session.phase) && h('ol', { 'data-testid': 'live-standings' },
        ...session.standings.map(row => h('li', { key: row.participantId }, `${row.nickname} · Rank: ${row.rank} · Total: ${row.total}`)))));
}
module.exports = { LivePanel };