const React = require('react');
const { subscribeController, getControllerSnapshot } = require('./controller-store');
const h = React.createElement;
const COMMANDS = ['start', 'open', 'close', 'reveal', 'next', 'finish'];

const STYLE = `
.lgu-activities-controller { box-sizing:border-box; height:100%; overflow:auto; padding:20px; color:#172b43; font:15px/1.5 system-ui,sans-serif; }
.lgu-activities-controller * { box-sizing:border-box; }
.lgu-activities-controller h2 { margin:0 0 12px; font-size:22px; }
.lgu-activities-controller button,.lgu-activities-controller select { font:inherit; padding:8px 10px; margin:4px; border:1px solid #bdcadd; border-radius:8px; background:#fff; color:inherit; }
.lgu-activities-controller button { cursor:pointer; }
.lgu-activities-controller button:disabled,.lgu-activities-controller select:disabled { opacity:.55; cursor:not-allowed; }
.lgu-activities-controller label { display:block; margin:12px 0 4px; }
.lgu-activities-controller__status { margin:12px 4px; padding:10px; border-radius:8px; background:#e8eef7; }
.lgu-activities-controller__actions { display:flex; flex-wrap:wrap; margin:12px 0; }
`;

function ControllerPanel({ runtime: suppliedRuntime }) {
  const sharedRuntime = React.useSyncExternalStore(subscribeController, getControllerSnapshot, getControllerSnapshot);
  const runtime = suppliedRuntime || sharedRuntime;
  const [topicId, setTopicId] = React.useState('');
  if (!runtime) return h('section', { className: 'lgu-activities-controller' }, h('p', { role: 'status' }, 'Loading controller…'));
  const { ready, status, error, context, session, connection, busy, canHost, selectedId,
    selectedSummary, createSession, command, selectSession, refresh } = runtime;
  const summaries = context?.sessions || [];
  const hasSelected = Boolean(selectedId && (selectedSummary || session));
  const phase = session?.phase || selectedSummary?.phase || '—';
  const sessionOptions = summaries.map(item => h('option', { key: item.id, value: item.id }, `${item.themeTitle} · ${item.phase}`));
  if (selectedId && !selectedSummary && session) sessionOptions.push(h('option', { key: selectedId, value: selectedId }, `${session.themeTitle} · ${session.phase}`));

  if (!ready || status === 'loading') return h('section', { className: 'lgu-activities-controller', 'aria-label': 'LGU Activities controller' },
    h('style', null, STYLE), h('h2', null, 'LGU Activities'),
    h('p', { role: 'status' }, 'Waiting for verified meeting identity…'));

  return h('section', { className: 'lgu-activities-controller', lang: 'el', 'aria-label': 'LGU Activities controller' },
    h('style', null, STYLE), h('h2', null, 'LGU Activities'),
    canHost && h(React.Fragment, null,
      h('label', null, 'Theme', h('select', { value: topicId, disabled: busy, 'data-testid': 'live-theme',
        onChange: event => setTopicId(event.target.value) },
      h('option', { value: '' }, 'Choose a theme'), ...(context?.themes || []).map(theme =>
        h('option', { key: theme.id, value: theme.id }, theme.title)))),
      h('button', { type: 'button', 'data-testid': 'live-create', disabled: busy || !topicId,
        onClick: () => { if (topicId) void createSession(topicId); } }, 'Create session')),
    (canHost || summaries.length > 0) && h('label', null, 'Session', h('select', { value: selectedId, disabled: busy,
      'data-testid': 'live-session-picker', onChange: event => selectSession(event.target.value) },
    h('option', { value: '' }, 'Choose a session'), ...sessionOptions)),
    canHost && h('div', { className: 'lgu-activities-controller__actions', 'aria-label': 'Live session controls' },
      ...COMMANDS.map(action => h('button', { key: action, type: 'button', 'data-testid': `live-command-${action}`,
        disabled: busy || !hasSelected || session?.role !== 'host',
        onClick: () => { void command(action); } }, action[0].toUpperCase() + action.slice(1)))),
    h('div', { className: 'lgu-activities-controller__status', role: error ? 'alert' : 'status', 'aria-live': 'polite' },
      error || (status === 'failed' ? 'Live service unavailable.' : !selectedId
        ? 'No active Live session. The presentation remains on stage.'
        : `${session?.themeTitle || selectedSummary?.themeTitle || 'Live session'} · ${phase}${connection ? ` · ${connection}` : ''}`)),
    h('button', { type: 'button', 'data-testid': 'live-refresh-context', disabled: busy, onClick: refresh }, 'Refresh status'));
}

module.exports = { COMMANDS, ControllerPanel };
