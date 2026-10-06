const { createIdentityService, ContractError } = require('./identity-service.cjs');
const { createBbbProofVerifier, createClassroomReader } = require('./providers.cjs');
const { createCoreCredentialVerifier, CORE_ISSUER } = require('./core-introspection.cjs');

function scopeBbbVerifier(verifyBbb, allowedMeetingIds) {
  if (allowedMeetingIds !== undefined && (!Array.isArray(allowedMeetingIds)
    || allowedMeetingIds.some((id) => typeof id !== 'string' || !id))) throw new TypeError('Invalid meeting scope');
  const scope = allowedMeetingIds === undefined ? undefined : new Set(allowedMeetingIds);
  return async (proof) => {
    const bbb = await verifyBbb(proof);
    if (scope !== undefined && !scope.has(bbb.externalMeetingId)) {
      throw new ContractError('MEETING_SCOPE_DENIED', 403);
    }
    return bbb;
  };
}

// No fixture provider. Runtime supplies scoped config and activity signing key.
async function createProductionIdentityService({ bbbHookUrl, resolveActivity, privateKey, publicKey,
  issuer, audience, kid, allowedMeetingIds }) {
  return createIdentityService({
    verifyBbbProof: scopeBbbVerifier(createBbbProofVerifier({ hookUrl: bbbHookUrl }), allowedMeetingIds),
    verifyCoreCredential: createCoreCredentialVerifier(),
    readClassroom: createClassroomReader({ coreOrigin: CORE_ISSUER }),
    coreIssuer: CORE_ISSUER, resolveActivity, privateKey, publicKey, issuer, audience, kid });
}
module.exports = { createProductionIdentityService, scopeBbbVerifier };