// Browser-only BFF transport. LGU signatures, tickets and credentials belong
// exclusively to the BFF. Contract pinned to LGU 36cd87f9 (live.ts / quiz.ts).
const PREFIX = '/api/lgu-activities/v1/live/';
const PHASES = ['lobby', 'prepare', 'open', 'closed', 'reveal', 'finished', 'cancelled'];
const ACTIONS = ['start', 'open', 'close', 'reveal', 'next', 'finish'];
const safeInteger = value => Number.isSafeInteger(value) && value >= 0;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 200;

class LiveError extends Error {
  constructor(code) { super(code); this.name = 'LiveError'; this.code = code; }
}
function errorMessage(error) {
  switch (error?.code) {
    case 'EXPIRED': return 'Connection expired. Reconnect explicitly to continue.';
    case 'STALE': return 'The session changed. Reconnect to load its current state; your action was not retried.';
    case 'DENIED': return 'Live access was refused. Reconnect to check access again.';
    default: return 'Live is unavailable. Reconnect to check again; no answer or command was retried.';
  }
}
function requireValue(condition) { if (!condition) throw new LiveError('INVALID_RESPONSE'); }
function noCredentials(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    requireValue(!/^(secret|token|ticket|credential|credentials|account|set-cookie|cookie|authorization)$/i.test(key));
    noCredentials(child);
  }
}
function validateContext(value) {
  const p = value?.principal;
  requireValue(id(p?.id) && ['moderator', 'viewer'].includes(p.role)
    && ['core', 'guest'].includes(p.identityKind) && typeof p.displayName === 'string'
    && typeof p.canHost === 'boolean' && (!p.canHost || p.role === 'moderator'));
  requireValue(value.themes === null || (Array.isArray(value.themes)
    && value.themes.every(t => id(t?.id) && typeof t.title === 'string')));
  requireValue(Array.isArray(value.sessions) && value.sessions.every(s => id(s?.id)
    && typeof s.themeTitle === 'string' && PHASES.includes(s.phase)
    && typeof s.joined === 'boolean' && typeof s.live === 'boolean'));
  return value;
}
function validateState(value, sessionId) {
  const s = value?.session;
  requireValue(s?.id === sessionId && PHASES.includes(s.phase) && safeInteger(s.phaseVersion)
    && safeInteger(s.questionIndex) && safeInteger(s.questionCount) && safeInteger(s.lastSeq)
    && ['host', 'participant'].includes(s.role) && Array.isArray(s.participants) && Array.isArray(s.standings));
  requireValue(typeof s.themeTitle === 'string' && s.questionCount > 0 && s.questionIndex < s.questionCount);
  requireValue(['prepare', 'open', 'closed', 'reveal'].includes(s.phase) ? Boolean(s.question) : s.question === null);
  if (s.question) {
    const q = s.question;
    requireValue(id(q.id) && q.index === s.questionIndex && q.total === s.questionCount && typeof q.prompt === 'string'
      && typeof q.kind === 'string' && validOptions(q.options));
    if (q.kind === 'match') requireValue(validOptions(q.rightOptions) && q.rightOptions.length === q.options.length);
  }
  requireValue(s.participants.every(p => id(p?.participantId) && ['account', 'guest'].includes(p.kind)
    && typeof p.nickname === 'string' && typeof p.removed === 'boolean'
    && typeof p.eligible === 'boolean' && typeof p.answered === 'boolean'));
  requireValue(s.me === null || (id(s.me?.participantId) && ['account', 'guest'].includes(s.me.kind)
    && typeof s.me.removed === 'boolean' && safeInteger(s.me.joinedPhaseVersion)));
  requireValue(s.own === null || (Array.isArray(s.own?.submitted) && s.own.submitted.every(v => typeof v === 'string')
    && typeof s.own.correct === 'boolean' && safeInteger(s.own.points)
    && safeInteger(s.own.elapsedMs) && typeof s.own.late === 'boolean'));
  requireValue(s.standings.every(row => id(row?.participantId) && typeof row.nickname === 'string'
    && safeInteger(row.total) && safeInteger(row.rank)));
  return value;
}
function validOptions(options) {
  return Array.isArray(options) && options.length >= 2 && options.length <= 6
    && options.every(o => id(o?.id) && typeof o.text === 'string')
    && new Set(options.map(o => o.id)).size === options.length;
}

// Incremental UTF-8 SSE parser, including split CRLF, comments, multiline
// data and EOF. Event payloads are notifications, never a second state source.
function createSSEParser(onEvent) {
  const decoder = new TextDecoder();
  let buffer = '';
  let event = 'message';
  let data = [];
  let eventId = '';
  const dispatch = () => {
    if (data.length) onEvent({ event, data: data.join('\n'), id: eventId });
    event = 'message'; data = []; eventId = '';
  };
  const line = text => {
    if (!text) { dispatch(); return; }
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon < 0 ? text : text.slice(0, colon);
    const value = colon < 0 ? '' : text.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    if (field === 'data') data.push(value);
    if (field === 'id' && !value.includes('\0')) eventId = value;
  };
  return {
    push(chunk, eof = false) {
      buffer += decoder.decode(chunk, { stream: !eof });
      requireValue(buffer.length + data.join('').length <= 65536);
      let match;
      while ((match = /[\r\n]/.exec(buffer))) {
        const at = match.index;
        if (buffer[at] === '\r' && at === buffer.length - 1 && !eof) break;
        const skip = buffer[at] === '\r' && buffer[at + 1] === '\n' ? 2 : 1;
        line(buffer.slice(0, at)); buffer = buffer.slice(at + skip);
      }
      if (eof) { if (buffer) line(buffer); buffer = ''; dispatch(); }
    },
  };
}

function createFederationClient({ sessionToken, coreToken, fetchImpl = globalThis.fetch,
  timers = globalThis } = {}) {
  let bbb = sessionToken;
  let core = coreToken;
  let expired = false;
  const lifetime = new AbortController();
  const watches = new Set();
  function scopedController(signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    lifetime.signal.addEventListener('abort', abort, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    if (lifetime.signal.aborted || signal?.aborted) abort();
    return { controller, clean() {
      lifetime.signal.removeEventListener('abort', abort);
      signal?.removeEventListener('abort', abort);
    } };
  }
  async function transport(route, body, signal, streaming = false) {
    if (expired) throw new LiveError('EXPIRED');
    if (!id(bbb) || lifetime.signal.aborted) throw new LiveError('DENIED');
    const scope = scopedController(signal);
    let timeout = timers.setTimeout(() => scope.controller.abort(), 10000);
    try {
      const response = await fetchImpl(PREFIX + route, {
        method: 'POST', mode: 'same-origin', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        signal: scope.controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: streaming ? 'text/event-stream' : 'application/json',
          'X-BBB-Session-Token': bbb, ...(core ? { Authorization: `Bearer ${core}` } : {}) },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        if (response.status === 401) { expired = true; throw new LiveError('EXPIRED'); }
        throw new LiveError(response.status === 409 ? 'STALE' : response.status === 403 ? 'DENIED' : 'UNAVAILABLE');
      }
      if (!streaming) {
        const value = await response.json();
        noCredentials(value);
        return value;
      }
      timers.clearTimeout(timeout); timeout = null;
      if (!response.body?.getReader || !/^text\/event-stream(?:;|$)/i.test(response.headers?.get('content-type') || '')) {
        await response.body?.cancel?.();
        throw new LiveError('NO_STREAM');
      }
      return { response, scope };
    } catch (error) {
      scope.controller.abort();
      throw error instanceof LiveError ? error : new LiveError('UNAVAILABLE');
    } finally {
      if (timeout !== null) timers.clearTimeout(timeout);
      if (!streaming || scope.controller.signal.aborted) scope.clean();
    }
  }
  const client = {
    async context() { return validateContext(await transport('context', {})); },
    async create(topicId) {
      requireValue(id(topicId));
      const value = await transport('create', { topicId });
      // LGU LiveSummary.entry is the string 'closed', not { live: 'closed' }.
      requireValue(id(value?.session?.id) && PHASES.includes(value.session.phase) && value.session.entry === 'closed');
      return value;
    },
    async enter(sessionId) {
      requireValue(id(sessionId));
      const value = await transport('enter', { sessionId });
      requireValue(value?.sessionId === sessionId && id(value.participant?.participantId)
        && ['account', 'guest'].includes(value.participant.kind) && typeof value.participant.displayName === 'string'
        && typeof value.created === 'boolean');
      return value;
    },
    async state(sessionId, signal) {
      requireValue(id(sessionId));
      return validateState(await transport('state', { sessionId }, signal), sessionId);
    },
    async command(sessionId, action, expectedVersion) {
      requireValue(id(sessionId) && ACTIONS.includes(action) && safeInteger(expectedVersion));
      const value = await transport('command', { sessionId, action, expectedVersion });
      requireValue(PHASES.includes(value?.phase) && safeInteger(value.phaseVersion));
      return value;
    },
    async answer(sessionId, questionIndex, phaseVersion, answer) {
      requireValue(id(sessionId) && safeInteger(questionIndex) && safeInteger(phaseVersion)
        && Array.isArray(answer) && answer.every(v => typeof v === 'string'));
      const value = await transport('answer', { sessionId, questionIndex, phaseVersion, answer });
      requireValue(value?.accepted === true && safeInteger(value.elapsedMs));
      return value;
    },
    watch(sessionId, { after = 0, onState, onError, onMode = () => {} }) {
      requireValue(id(sessionId) && safeInteger(after));
      const stopController = new AbortController();
      let stopped = false;
      let cursor = after;
      let timer;
      let refreshPromise;
      let again = false;
      let activeStream;
      let reader;
      const stop = () => {
        if (stopped) return;
        stopped = true; stopController.abort(); timers.clearTimeout(timer);
        activeStream?.scope.controller.abort();
        void reader?.cancel().catch(() => {});
        watches.delete(stop);
      };
      const fail = error => { if (!stopped) { stop(); onError(error); } };
      const refresh = () => {
        if (stopped) return Promise.resolve();
        if (refreshPromise) { again = true; return refreshPromise; }
        refreshPromise = (async () => {
          do {
            again = false;
            const value = await client.state(sessionId, stopController.signal);
            if (!stopped) {
              cursor = Math.max(cursor, value.session.lastSeq);
              onState(value.session);
            }
          } while (again && !stopped);
        })().catch(fail).finally(() => { refreshPromise = null; });
        return refreshPromise;
      };
      const poll = () => {
        if (stopped) return;
        onMode('polling');
        timer = timers.setTimeout(async () => { await refresh(); poll(); }, 3000);
      };
      const connect = async attempt => {
        if (stopped) return;
        let receivedEvent = false;
        let endedNormally = false;
        try {
          activeStream = await transport('stream', { sessionId, after: cursor }, stopController.signal, true);
          if (stopped) { activeStream.scope.controller.abort(); await activeStream.response.body.cancel(); return; }
          onMode('streaming');
          reader = activeStream.response.body.getReader();
          const parser = createSSEParser(notification => {
            let payload;
            try { payload = JSON.parse(notification.data); } catch { throw new LiveError('INVALID_RESPONSE'); }
            noCredentials(payload);
            receivedEvent = true;
            const sequence = Number(notification.id || payload?.seq);
            if (safeInteger(sequence)) cursor = Math.max(cursor, sequence);
            // hello reconciles on reconnect, ping reconciles any missed log entry.
            void refresh();
          });
          while (!stopped) {
            const idle = timers.setTimeout(() => activeStream?.scope.controller.abort(), 45000);
            let chunk;
            try { chunk = await reader.read(); } finally { timers.clearTimeout(idle); }
            if (chunk.done) { parser.push(undefined, true); endedNormally = true; break; }
            parser.push(chunk.value);
          }
        } catch (error) {
          if (['EXPIRED', 'DENIED', 'STALE', 'INVALID_RESPONSE'].includes(error?.code)) { fail(error); return; }
          if (error?.code === 'NO_STREAM') { poll(); return; }
        } finally {
          if (reader) { try { await reader.cancel(); } catch { /* closed */ } reader.releaseLock(); reader = null; }
          activeStream?.scope.controller.abort(); activeStream?.scope.clean(); activeStream = null;
        }
        if (stopped) return;
        // A valid orderly EOF renews the BFF's 20s reauthentication window.
        // Empty streams and actual network failures keep the bounded budget.
        if (endedNormally && receivedEvent) {
          onMode('reconnecting');
          timer = timers.setTimeout(() => { void connect(0); }, 1000);
          return;
        }
        if (attempt >= 3) { poll(); return; }
        onMode('reconnecting');
        timer = timers.setTimeout(() => { void connect(attempt + 1); }, 1000 * (2 ** attempt));
      };
      watches.add(stop);
      void refresh().then(() => { if (!stopped) void connect(0); });
      return { stop, refresh };
    },
    dispose() { for (const stop of [...watches]) stop(); lifetime.abort(); bbb = null; core = null; },
  };
  return client;
}
module.exports = { createFederationClient, createSSEParser, LiveError, errorMessage };