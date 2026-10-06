const { ContractError } = require('./identity-service.cjs');

function fixedUrl(raw, loopbackAllowed = false) {
  const url = new URL(raw);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash
    || !(url.protocol === 'https:' || (loopbackAllowed && loopback && url.protocol === 'http:'))) {
    throw new TypeError('Fixed trusted HTTPS URL (or loopback BBB hook) required');
  }
  return url;
}
function createBbbProofVerifier({ hookUrl, fetchImpl = fetch }) {
  const url = fixedUrl(hookUrl, true);
  if (url.pathname !== '/bigbluebutton/connection/checkGraphqlAuthorization') throw new TypeError('BBB auth hook path required');
  return async ({ sessionToken, cookie }) => {
    if (typeof sessionToken !== 'string' || /[\r\n]/.test(sessionToken)
      || (cookie !== undefined && (typeof cookie !== 'string' || cookie.length > 8192 || /[\r\n]/.test(cookie)))) {
      throw new ContractError('BBB_PROOF_INVALID', 401);
    }
    const response = await fetchImpl(url.href, { method: 'GET', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json', 'x-session-token': sessionToken,
        ...(cookie ? { Cookie: cookie } : {}) } });
    if (response.status !== 200 || (await response.json()).response !== 'authorized') {
      throw new ContractError('BBB_PROOF_INVALID', 401);
    }
    const header = (name) => response.headers.get(name);
    const moderator = header('User-Is-Moderator');
    if (!['true', 'false'].includes(moderator)) throw new ContractError('BBB_PROOF_INVALID', 401);
    return { meetingId: header('Meeting-Id'), externalMeetingId: header('Meeting-External-Id'),
      participantId: header('User-Id'), extId: header('User-External-Id'),
      moderator: moderator === 'true', online: header('User-Currently-Online') === 'true' };
  };
}
function createClassroomReader({ coreOrigin, fetchImpl = fetch }) {
  const origin = fixedUrl(coreOrigin);
  if (origin.pathname !== '/') throw new TypeError('Core origin without a path required');
  const url = new URL('/api/integrations/bbb/classroom/context', origin);
  return async (coreToken) => {
    const response = await fetchImpl(url.href, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
      signal: AbortSignal.timeout(5000), headers: { Authorization: `Bearer ${coreToken}`, Accept: 'application/json' } });
    if (response.status !== 200) throw new ContractError('CORE_CONTEXT_DENIED');
    return response.json();
  };
}
module.exports = { createBbbProofVerifier, createClassroomReader };