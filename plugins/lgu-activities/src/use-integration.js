const React = require('react');
const { isTeacher } = require('./access');
const { USER_METADATA_QUERY, PRESENCE_SUBSCRIPTION, extractCoreToken,
  mapObservedParticipants, createActivityClient } = require('./integration-client');

function useLiveIntegration(pluginApi, user) {
  const metadata = pluginApi.useCustomQuery(USER_METADATA_QUERY);
  const settings = pluginApi.usePluginSettings();
  const presence = pluginApi.useCustomSubscription(PRESENCE_SUBSCRIPTION);
  const token = extractCoreToken(metadata);
  const activityId = settings?.data?.liveActivityId;
  const sessionToken = pluginApi.getSessionToken();
  const clientRef = React.useRef(null);
  const [state, setState] = React.useState({ status: 'unavailable' });
  const [generation, retry] = React.useReducer((value) => value + 1, 0);
  React.useEffect(() => {
    setState({ status: 'unavailable' });
    if (!isTeacher(user) || !token || !sessionToken || metadata?.loading || metadata?.data?.loading
      || settings?.loading || settings?.error) return undefined;
    let current = true;
    let timer;
    const client = createActivityClient({ sessionToken, coreToken: token });
    clientRef.current = client;
    setState({ status: 'loading' });
    client.identify().then((result) => {
      if (!current) return;
      if (result.identity?.role !== 'teacher' || result.identity.personId !== user.data.extId
        || result.identity.participantId !== user.data.userId
        || result.classroom?.teacher?.personId !== result.identity.personId
        || !Array.isArray(result.classroom?.students) || !Number.isSafeInteger(result.expiresAt)
        || result.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('IDENTITY_INVALID');
      setState({ status: 'ready', identity: result.identity, classroom: result.classroom });
      timer = setTimeout(() => {
        if (current) { client.dispose(); clientRef.current = null; setState({ status: 'expired' }); }
      }, Math.max(0, result.expiresAt * 1000 - Date.now()));
    }).catch(() => { if (current) setState({ status: 'denied' }); });
    return () => { current = false; clearTimeout(timer); client.dispose(); clientRef.current = null; };
  }, [user?.data?.userId, user?.data?.extId, isTeacher(user), token, sessionToken,
    metadata?.loading, metadata?.data?.loading, settings?.loading, settings?.error, generation]);

  const ready = Boolean(token && sessionToken && !metadata?.loading && !metadata?.data?.loading
    && !settings?.loading && !settings?.error
    && state.identity?.personId === user?.data?.extId && state.identity?.participantId === user?.data?.userId
    && isTeacher(user) && ['ready', 'preparing', 'prepared'].includes(state.status));
  const rows = presence?.error || presence?.data?.error || presence?.loading || presence?.data?.loading
    ? undefined : presence?.data?.data?.user ?? presence?.data?.user;
  async function prepare() {
    const client = clientRef.current;
    if (!ready || !client || typeof activityId !== 'string' || !activityId.trim()
      || state.status === 'preparing') return;
    setState((previous) => ({ ...previous, status: 'preparing' }));
    try {
      const result = await client.prepare(activityId);
      if (clientRef.current === client) {
        setState((previous) => ({ ...previous, status: 'prepared', context: result.context, classroom: result.context }));
      }
    } catch {
      if (clientRef.current === client) { client.dispose(); clientRef.current = null; setState({ status: 'denied' }); }
    }
  }
  return { ...state, ready, canPrepare: ready && typeof activityId === 'string'
    && activityId.trim().length > 0 && activityId.length <= 256 && state.status !== 'preparing',
    participants: mapObservedParticipants(state.classroom, rows, user?.data?.userId), prepare, retry };
}
module.exports = { useLiveIntegration };