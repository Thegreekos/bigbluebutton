const { ContractError } = require('./identity-service.cjs');
const { PREFIX, safeView, validPrivateResourcePath } = require('./federation-client.cjs');
const pkg = require('../package.json');
const id = value => typeof value === 'string' && /^[\da-f-]{36}$/i.test(value);
function bodyKeys(body, keys) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== keys.length
    || !keys.every(key => Object.hasOwn(body, key))) throw new ContractError('INVALID_BODY', 400);
}
function createLiveBff({ identityService, client, maxSessions = 1000, pluginCommit = 'unreleased' }) {
  const records = new Map(); const locks = new Map();
  const proofKeys = new Map();
  let creating = 0;
  async function authenticated(proof) {
    const result = await identityService.identifySelf(proof, {}); const identity = result.identity;
    if (!identity || !['core', 'guest'].includes(identity.mode) || typeof identity.organiser !== 'boolean'
      || !identity.meetingId || !identity.participantId || !identity.principalId || result.expiresAt <= client.clock()) {
      throw new ContractError('PROOF_INVALID', 401);
    }
    return { identity, expiresAt: result.expiresAt };
  }
  async function locked(key, action) {
    if (!locks.has(key) && locks.size >= maxSessions) throw new ContractError('FEDERATION_CAPACITY', 503);
    const previous = locks.get(key) || Promise.resolve(); let release;
    const next = new Promise(resolve => { release = resolve; }); locks.set(key, next);
    await previous;
    try { return await action(); } finally { release(); if (locks.get(key) === next) locks.delete(key); }
  }
  const keyOf = a => JSON.stringify([a.identity.meetingId, a.identity.principalId]);
  const fingerprint = a => JSON.stringify([a.identity.mode, a.identity.coreIssuer, a.identity.corePersonId, a.identity.organiser]);
  function forget(key) { const r = records.get(key); r?.vault.clear(); records.delete(key);
    for (const [proof, held] of proofKeys) if (held === key) proofKeys.delete(proof); }
  async function record(auth) {
    const key = keyOf(auth);
    for (const [k, r] of records) if (r.expiresAt <= client.clock()) forget(k);
    let r = records.get(key);
    if (r && r.fingerprint !== fingerprint(auth)) { forget(key); throw new ContractError('FEDERATION_IDENTITY_CHANGED', 409); }
    if (!r) {
      if (records.size + creating >= maxSessions) throw new ContractError('FEDERATION_CAPACITY', 503);
      creating += 1;
      try {
      const i = auth.identity;
      const result = await client.request('POST', PREFIX + 'launch', {
        meeting: { id: i.meetingId, name: 'BBB meeting' },
        participant: { id: i.principalId, role: i.organiser ? 'moderator' : 'viewer',
          displayName: i.organiser ? 'BBB Moderator' : 'BBB Participant',
          identity: i.mode === 'core' ? { kind: 'core', issuer: i.coreIssuer, subject: i.corePersonId } : { kind: 'guest' } },
        plugin: { name: 'LGU Activities', version: pkg.version, commit: pluginCommit },
      }, { signed: true });
      if (!id(result.principal?.id) || result.principal.role !== (i.organiser ? 'moderator' : 'viewer')
        || result.principal.identityKind !== i.mode || result.principal.canHost !== i.organiser
        || result.meeting?.key !== i.meetingId || typeof result.ticket !== 'string'
        || !/^[\w-]{43}$/.test(result.ticket) || result.expiresIn !== 120) throw new ContractError('LGU_INVALID_RESPONSE', 502);
      r = { principalId: result.principal.id, fingerprint: fingerprint(auth), vault: client.vault(),
        expiresAt: client.clock() + 43200, entered: new Set() };
      const activation = await client.request('POST', PREFIX + 'activate', { ticket: result.ticket }, { vault: r.vault });
      if (activation.principal?.id !== r.principalId || activation.principal.role !== result.principal.role
        || activation.principal.identityKind !== i.mode || activation.principal.canHost !== i.organiser
        || activation.meeting?.key !== i.meetingId || !r.vault.has('lgu_fed')
        || (i.mode === 'core' && !r.vault.has('lgu_session')) || (i.mode === 'guest' && r.vault.has('lgu_session'))) {
        r.vault.clear(); throw new ContractError('LGU_INVALID_RESPONSE', 502);
      }
      records.set(key, r);
      } finally { creating -= 1; }
    }
    return r;
  }
  const signedPath = (path, r, after) => path + '?' + new URLSearchParams({ principalId: r.principalId,
    ...(after === undefined ? {} : { after: String(after) }) });
  async function context(auth, r) {
    const view = await client.request('GET', signedPath(PREFIX + 'context', r), undefined, { signed: true });
    if (view.principal?.id !== r.principalId || view.principal.canHost !== auth.identity.organiser
      || view.meeting?.key !== auth.identity.meetingId || !Array.isArray(view.sessions)
      || (auth.identity.organiser ? !Array.isArray(view.themes) : view.themes !== null)) throw new ContractError('LGU_INVALID_RESPONSE', 502);
    return view;
  }
  async function boundSession(auth, r, sessionId) {
    if (!id(sessionId)) throw new ContractError('INVALID_BODY', 400);
    const view = await context(auth, r);
    if (!view.sessions.some(s => s.id === sessionId)) throw new ContractError('SESSION_NOT_FOUND', 404);
  }
  async function enter(auth, r, sessionId) {
    if (auth.identity.organiser) throw new ContractError('ORGANISER_NOT_PLAYER', 409);
    const result = await client.request('POST', PREFIX + `sessions/${sessionId}/enter`, {}, { vault: r.vault });
    if (result.sessionId !== sessionId || !id(result.participant?.participantId)
      || result.participant.kind !== (auth.identity.mode === 'core' ? 'account' : 'guest')
      || (auth.identity.mode === 'guest' && !r.vault.has('lgu_live'))) throw new ContractError('LGU_INVALID_RESPONSE', 502);
    r.entered.add(sessionId); return result;
  }
  return {
    async handle(operation, proof, body, signal) {
      const expected = { context: [], create: ['topicId'], enter: ['sessionId'], state: ['sessionId'],
        command: ['sessionId', 'action', 'expectedVersion'], answer: ['sessionId', 'questionIndex', 'phaseVersion', 'answer'],
        stream: ['sessionId', 'after'] }[operation];
      if (!expected) throw new ContractError('NOT_FOUND', 404);
      bodyKeys(body, expected);
      let auth;
      // Store only a digest of BBB session proof for cleanup on revocation, never
      // the raw proof/credential. A failed fresh check cannot leave its vault live.
      const proofKey = require('node:crypto').createHash('sha256').update(String(proof?.sessionToken ?? '')).digest('hex');
      try { auth = await authenticated(proof); }
      catch (error) { const previous = proofKeys.get(proofKey); if (previous) forget(previous); throw error; }
      const key = keyOf(auth);
      return locked(key, async () => {
        try {
          if (['create', 'command'].includes(operation) && !auth.identity.organiser) throw new ContractError('TEACHER_REQUIRED', 403);
          if (operation === 'answer' && auth.identity.organiser) throw new ContractError('ORGANISER_NOT_PLAYER', 403);
          const r = await record(auth);
          proofKeys.set(proofKey, key);
          while (proofKeys.size > maxSessions * 32) proofKeys.delete(proofKeys.keys().next().value);
          if (operation === 'context') return safeView(await context(auth, r));
          if (operation === 'create') {
            if (typeof body.topicId !== 'string' || !body.topicId || body.topicId.length > 200) throw new ContractError('INVALID_BODY', 400);
            const view = await context(auth, r);
            if (!view.themes.some(t => t.id === body.topicId)) throw new ContractError('THEME_NOT_ALLOWED', 403);
            const result = await client.request('POST', PREFIX + 'sessions', { principalId: r.principalId, topicId: body.topicId }, { signed: true });
            if (!id(result.session?.id) || result.session.entry !== 'closed') throw new ContractError('LGU_ENTRY_NOT_CLOSED', 502);
            return safeView(result);
          }
          await boundSession(auth, r, body.sessionId);
          if (operation === 'enter') return safeView(await enter(auth, r, body.sessionId));
          if (!auth.identity.organiser && !r.entered.has(body.sessionId)) await enter(auth, r, body.sessionId);
          const hostPath = PREFIX + `sessions/${body.sessionId}`;
          const learnerPath = `/api/v1/live/${body.sessionId}`;
          if (operation === 'state') {
            const result = await client.request('GET', auth.identity.organiser ? signedPath(hostPath, r) : learnerPath,
              undefined, auth.identity.organiser ? { signed: true } : { vault: r.vault });
            if (result.session?.id !== body.sessionId || result.session.entry !== 'closed'
              || result.session.role !== (auth.identity.organiser ? 'host' : 'participant')) throw new ContractError('LGU_INVALID_RESPONSE', 502);
            if (['prepare', 'open', 'closed', 'reveal'].includes(result.session.phase)
              && (!result.session.question || typeof result.session.question.prompt !== 'string'
                || !Array.isArray(result.session.question.options))) throw new ContractError('LGU_INVALID_RESPONSE', 502);
            return safeView(result);
          }
          if (operation === 'command') {
            if (!['start', 'open', 'close', 'reveal', 'next', 'finish', 'cancel'].includes(body.action)
              || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) throw new ContractError('INVALID_BODY', 400);
            return safeView(await client.request('POST', hostPath + '/command', { principalId: r.principalId,
              action: body.action, expectedVersion: body.expectedVersion }, { signed: true }));
          }
          if (operation === 'answer') {
            if (![body.questionIndex, body.phaseVersion].every(n => Number.isSafeInteger(n) && n >= 0)
              || !Array.isArray(body.answer) || body.answer.length > 100 || body.answer.some(v => typeof v !== 'string' || v.length > 200)) {
              throw new ContractError('INVALID_BODY', 400);
            }
            return safeView(await client.request('POST', learnerPath + '/answer', { questionIndex: body.questionIndex,
              phaseVersion: body.phaseVersion, answer: body.answer }, { vault: r.vault }));
          }
          if (!Number.isSafeInteger(body.after) || body.after < 0) throw new ContractError('INVALID_BODY', 400);
          const options = { stream: true, signal, ...(auth.identity.organiser ? { signed: true } : { vault: r.vault }) };
          return client.request('GET', auth.identity.organiser ? signedPath(hostPath + '/stream', r, body.after)
            : learnerPath + `/stream?after=${body.after}`, undefined, options);
        } catch (error) {
          if ([401, 403, 404, 502, 503].includes(error.status)) forget(key);
          throw error;
        }
      });
    },
    async handlePlayer(operation, proof, body, signal) {
      if (operation === 'state') return this.handle('state', proof, { sessionId: body.sessionId }, signal);
      if (operation === 'stream') return this.handle('stream', proof, { sessionId: body.sessionId, after: body.after }, signal);
      if (operation === 'answer') return this.handle('answer', proof, { sessionId: body.sessionId,
        questionIndex: body.questionIndex, phaseVersion: body.phaseVersion, answer: body.answer }, signal);
      throw new ContractError('NOT_FOUND', 404);
    },
    async handlePlayerResource(path, proof, signal, headers = {}) {
      if (!validPrivateResourcePath(path)) throw new ContractError('NOT_FOUND', 404);
      const proofKey = require('node:crypto').createHash('sha256').update(String(proof?.sessionToken ?? '')).digest('hex');
      let auth;
      try { auth = await authenticated(proof); }
      catch (error) { const previous = proofKeys.get(proofKey); if (previous) forget(previous); throw error; }
      const key = keyOf(auth);
      return locked(key, async () => {
        try {
          const r = await record(auth);
          const audioSession = path.startsWith('/api/audio?') ? new URL(path, 'https://lgu.invalid').searchParams.get('id') : null;
          // Learner media is available only after this same principal entered a live room.
          // A host's activated Core credential may read its own permitted media.
          if (!r.vault.header() || (!auth.identity.organiser
            && (r.entered.size === 0 || (audioSession && !r.entered.has(audioSession))))) {
            throw new ContractError('LIVE_ENTRY_REQUIRED', 403);
          }
          proofKeys.set(proofKey, key);
          return await client.resource(path, { vault: r.vault, signal, accept: headers.accept,
            client: headers.client });
        } catch (error) {
          if ([401, 403, 404, 502, 503].includes(error.status)) forget(key);
          throw error;
        }
      });
    },
    dispose() { for (const key of records.keys()) forget(key); },
  };
}
module.exports = { createLiveBff };