const { createIdentityService } = require('./identity-service.cjs');
const { createBbbProofVerifier, createClassroomReader } = require('./providers.cjs');
const { createCoreCredentialVerifier, CORE_ISSUER } = require('./core-introspection.cjs');

// No listener, deployment, new signing key or fixture provider. Existing host
// supplies BBB hook config, activity allowlist and activity-signing parameters.
async function createProductionIdentityService({ bbbHookUrl, resolveActivity, privateKey, publicKey,
  issuer, audience, kid }) {
  return createIdentityService({ verifyBbbProof: createBbbProofVerifier({ hookUrl: bbbHookUrl }),
    verifyCoreCredential: createCoreCredentialVerifier(),
    readClassroom: createClassroomReader({ coreOrigin: CORE_ISSUER }),
    coreIssuer: CORE_ISSUER, resolveActivity, privateKey, publicKey, issuer, audience, kid });
}
module.exports = { createProductionIdentityService };