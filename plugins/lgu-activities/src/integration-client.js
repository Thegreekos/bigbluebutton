// Same self-scoped userdata retrieval as TGOS Lesson Assistant. Never query
// another participant's token; the server validates both proofs independently.
const USER_METADATA_QUERY = `query LGUActivitiesUserMetadata {
  user_metadata { parameter value }
}`;
const PRESENCE_SUBSCRIPTION = `subscription LGUActivitiesPresence {
  user { userId extId name joined currentlyInMeeting disconnected loggedOut expired bot }
}`;

function extractCoreToken(result) {
  if (result?.loading || result?.error || result?.data?.error) return null;
  const rows = result?.data?.data?.user_metadata ?? result?.data?.user_metadata;
  if (!Array.isArray(rows)) return null;
  const tokens = rows.filter((row) => row?.parameter === 'schoolcore_context_token');
  return tokens.length === 1 && typeof tokens[0].value === 'string' && tokens[0].value.trim()
    ? tokens[0].value.trim() : null;
}
function mapObservedParticipants(classroom, rows, currentUserId) {
  if (!Array.isArray(rows) || !Array.isArray(classroom?.students)) return [];
  const live = rows.filter((p) => p.userId !== currentUserId && p.joined === true
    && p.currentlyInMeeting === true && !p.disconnected && !p.loggedOut && !p.expired && !p.bot);
  const ids = new Set(classroom.students.map((student) => student.personId));
  return live.map((p) => {
    const matched = typeof p.extId === 'string' && ids.has(p.extId)
      && live.filter((other) => other.extId === p.extId).length === 1;
    return { participantId: p.userId, personId: matched ? p.extId : null,
      status: matched ? 'roster-observed' : 'temporary-unverified' };
  });
}
function createActivityClient({ sessionToken, coreToken, fetchImpl = fetch }) {
  let bbbProof = sessionToken;
  let coreProof = coreToken;
  let activityToken;
  let contextId;
  const controller = new AbortController();
  async function request(route, body) {
    if (!bbbProof || !coreProof || controller.signal.aborted) throw new Error('PROOF_REQUIRED');
    const response = await fetchImpl(`/api/lgu-activities/v1/${route}`, {
      method: 'POST', mode: 'same-origin', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json',
        'X-BBB-Session-Token': bbbProof, Authorization: `Bearer ${coreProof}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('INTEGRATION_DENIED');
    return response.json();
  }
  return {
    identify() { return request('identity', {}); },
    async prepare(activityId) {
      const result = await request('contexts', { activityId });
      if (typeof result.identityToken !== 'string' || !result.context?.id
        || result.context.activityId !== activityId || result.context.lguSessionId !== null
        || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Math.floor(Date.now() / 1000)) {
        throw new Error('INVALID_CONTEXT');
      }
      activityToken = result.identityToken;
      contextId = result.context.id;
      // Token stays only in this closure, never React state/DOM/storage.
      return { context: result.context, identity: result.identity, expiresAt: result.expiresAt };
    },
    verifyPreparedIdentity() { return request('verify', { contextId, identityToken: activityToken }); },
    dispose() { bbbProof = null; coreProof = null; activityToken = null; contextId = null; controller.abort(); },
  };
}
module.exports = { USER_METADATA_QUERY, PRESENCE_SUBSCRIPTION, extractCoreToken, mapObservedParticipants, createActivityClient };