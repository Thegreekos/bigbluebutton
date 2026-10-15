const React = require('react');
const { metadataState, extractCoreToken, USER_METADATA_QUERY } = require('./integration-client');
const { createFederationClient } = require('./federation-client');

const ACTIVE_PHASES = new Set(['prepare', 'open', 'closed', 'reveal']);

function useLiveRuntime(pluginApi, user) {
  const metadata = pluginApi.useCustomQuery(USER_METADATA_QUERY);
  const credentialState = metadataState(metadata);
  const coreToken = extractCoreToken(metadata);
  const sessionToken = pluginApi.getSessionToken();
  const userReady = user?.loading === false && !user.error && !user.data?.error
    && typeof user.data?.userId === 'string' && Boolean(user.data.userId)
    && ['MODERATOR', 'VIEWER'].includes(user.data.role);
  const ready = userReady && ['present', 'absent'].includes(credentialState) && Boolean(sessionToken);
  const [context, setContext] = React.useState(null);
  const [status, setStatus] = React.useState('loading');
  const [error, setError] = React.useState(null);
  const [selectedId, setSelectedId] = React.useState('');
  const [session, setSession] = React.useState(null);
  const [connection, setConnection] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const clientRef = React.useRef(null);
  const watchRef = React.useRef(null);
  const busyRef = React.useRef(false);
  const canHost = ready && user.data.role === 'MODERATOR'
    && context?.principal?.canHost === true && context.principal.role === 'moderator';

  const applyContext = React.useCallback((value) => {
    setContext(value);
    if (user?.data?.role !== 'MODERATOR') {
      const candidate = value.sessions.find((item) => ACTIVE_PHASES.has(item.phase))
        || value.sessions.find((item) => item.phase === 'lobby' && item.live);
      setSelectedId(candidate?.id || '');
    }
  }, [user?.data?.role]);

  const refresh = React.useCallback(async () => {
    const client = clientRef.current;
    if (!client || busyRef.current) return;
    try { applyContext(await client.context()); setStatus('ready'); setError(null); }
    catch { setError('Live service is unavailable.'); setStatus('failed'); }
  }, [applyContext]);

  React.useEffect(() => {
    setContext(null); setSelectedId(''); setSession(null); setError(null); setStatus('loading');
    if (!ready) return undefined;
    const client = createFederationClient({ sessionToken, coreToken });
    clientRef.current = client;
    let current = true;
    let refreshing = false;
    let timer = null;
    const refreshContext = async () => {
      if (refreshing || !current) return;
      refreshing = true;
      try {
        const value = await client.context();
        if (current) { applyContext(value); setStatus('ready'); setError(null); }
      } catch (failure) {
        // A 403 is a standing refusal (issuer, organiser or licence), not an outage: polling again only
        // makes the BFF launch again every 3 s. Stop until the panel remounts.
        const denied = failure?.code === 'DENIED';
        if (denied) { clearInterval(timer); timer = null; }
        if (current) { setError(denied ? 'Live access is not permitted for this meeting.' : 'Live service is unavailable.'); setStatus('failed'); }
      } finally { refreshing = false; }
    };
    timer = setInterval(refreshContext, 3000);
    void refreshContext();
    return () => {
      current = false; clearInterval(timer); watchRef.current?.stop(); watchRef.current = null;
      client.dispose(); if (clientRef.current === client) clientRef.current = null;
    };
  }, [pluginApi, ready, user?.data?.userId, user?.data?.role, credentialState, sessionToken, coreToken, applyContext]);

  React.useEffect(() => {
    setSession(null); setConnection('');
    const client = clientRef.current;
    if (!ready || status !== 'ready' || !selectedId || !client) return undefined;
    let current = true;
    const watch = client.watch(selectedId, {
      onState(value) { if (current) setSession(previous => !previous || value.phaseVersion >= previous.phaseVersion ? value : previous); },
      onError() { if (current) { setSession(null); setError('Live access is unavailable.'); setStatus('failed'); } },
      onMode(value) { if (current) setConnection(value); },
    });
    watchRef.current = watch;
    return () => { current = false; watch.stop(); if (watchRef.current === watch) watchRef.current = null; };
  }, [ready, status, selectedId]);

  async function mutate(operation) {
    const client = clientRef.current;
    if (!canHost || status !== 'ready' || !client || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try { await operation(client); }
    catch { setError('The Live action could not be completed. Refresh and try again.'); }
    finally { busyRef.current = false; setBusy(false); }
  }

  const createSession = (topicId) => mutate(async client => {
    const result = await client.create(topicId);
    setSelectedId(result.session.id);
    await refresh();
  });
  const command = (action) => mutate(async client => {
    const current = session;
    if (!current || current.role !== 'host') return;
    await client.command(current.id, action, current.phaseVersion);
    await watchRef.current?.refresh();
    await refresh();
  });
  const selectSession = (id) => { if (canHost) { setSession(null); setSelectedId(id); } };
  const selectedSummary = context?.sessions.find(item => item.id === selectedId);
  const showMainStage = Boolean(session && ACTIVE_PHASES.has(session.phase));

  return {
    controller: { ready, status, error, context, session, connection, busy, canHost,
      selectedId, selectedSummary, showMainStage, createSession, command, selectSession, refresh },
    playerAuth: { sessionToken, coreToken },
  };
}

module.exports = { ACTIVE_PHASES, useLiveRuntime };
